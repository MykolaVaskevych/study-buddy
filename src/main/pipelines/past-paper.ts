import type { ExamProfile } from '@shared/domain'
import type { PastPaperAnalysis } from '../ai/types'
import { normaliseFormats, resolveExamProfile } from './exam-profile'
import type { PastPaperResult, TopicId } from '@shared/domain'
import type { Material } from './material'
import type { Planner } from './planner'
import { leafTopics, requireDoc } from './scope'
import { ServiceError, type Handlers, type PipelineDeps } from './types'
import type { UsageLedger } from './usage'

/** How much past papers count against the AI's own estimate when both exist. */
export const PAST_PAPER_WEIGHT = 0.6

/**
 * New exam weights: blend the share of past-paper marks per topic with the current weights,
 * then normalise to sum 1. Topics never examined keep (1 − blend) of their weight.
 */
export function blendWeights(
  current: ReadonlyMap<TopicId, number>,
  marks: ReadonlyMap<TopicId, number>,
  blend = PAST_PAPER_WEIGHT
): Map<TopicId, number> {
  const totalMarks = [...marks.values()].reduce((a, b) => a + b, 0)
  const totalCurrent = [...current.values()].reduce((a, b) => a + b, 0) || 1
  const raw = new Map<TopicId, number>()
  for (const [id, w] of current) {
    const paper = totalMarks > 0 ? (marks.get(id) ?? 0) / totalMarks : w / totalCurrent
    raw.set(id, blend * paper + (1 - blend) * (w / totalCurrent))
  }
  const sum = [...raw.values()].reduce((a, b) => a + b, 0) || 1
  return new Map([...raw].map(([id, w]) => [id, w / sum]))
}

/** Below this share of marks needing a formula, the exam counts as formula-free. */
const FORMULA_FREE_BELOW = 0.1
/** From this share of calculation marks on, formulas must be applied, not just recognised. */
const APPLY_FROM = 0.15

/** What the papers say about the exam: format mix by marks, formula use, style, examples. */
export function profileFromPapers(current: ExamProfile, analyses: readonly PastPaperAnalysis[]): ExamProfile {
  const qs = analyses.flatMap((a) => a.questions)
  const weight = (q: { marks: number }): number => Math.max(q.marks, 0.5)
  const total = qs.reduce((s, q) => s + weight(q), 0) || 1
  const share = (pred: (q: (typeof qs)[number]) => boolean): number =>
    qs.filter(pred).reduce((s, q) => s + weight(q), 0) / total
  const formats = normaliseFormats({
    mcq: share((q) => q.format === 'mcq'),
    written: share((q) => q.format === 'written'),
    numeric: share((q) => q.format === 'numeric')
  })
  const formulaShare = share((q) => q.usesFormula)
  const sheet = analyses.map((a) => a.formulaSheet).find((v) => v !== null)
  return {
    ...current,
    formats,
    formulas:
      formulaShare < FORMULA_FREE_BELOW ? 'none' : formats.numeric >= APPLY_FROM ? 'apply' : 'recognise',
    formulaSheet: sheet ?? current.formulaSheet,
    style:
      analyses
        .map((a) => a.style)
        .filter(Boolean)
        .join(' ') || current.style,
    examples: [...analyses.flatMap((a) => a.examples), ...current.examples].slice(0, 5),
    source: 'past_paper'
  }
}

/** Past exam papers → marks per topic → recalibrated exam weights → re-plan. */
export function createPastPapers(
  deps: Pick<PipelineDeps, 'db' | 'library' | 'pickPdfs' | 'aiFor' | 'now' | 'emit'>,
  services: { ledger: UsageLedger; material: Material; planner: Planner }
): { handlers: Pick<Handlers, 'plan.importPastPaper'> } {
  const { db } = deps
  return {
    handlers: {
      async 'plan.importPastPaper'({ docId, paths }): Promise<PastPaperResult> {
        const doc = requireDoc(db, docId)
        const leaves = leafTopics(db.topics.list(docId)).filter((t) => t.estimates !== null)
        if (leaves.length === 0)
          throw new ServiceError(
            'validation',
            'Build the course map first: past papers are matched to its topics.'
          )
        const files = paths ?? (await deps.pickPdfs())
        if (files.length === 0) return { questionsMapped: 0, unmapped: 0, changes: [], profile: null }

        const keyOf = new Map(leaves.map((t, i) => [`t${i + 1}`, t.id]))
        const topics = leaves.map((t, i) => ({
          key: `t${i + 1}`,
          title: t.title,
          pageStart: t.pageStart,
          pageEnd: t.pageEnd
        }))
        const marks = new Map<TopicId, number>()
        let mapped = 0
        let unmapped = 0
        const analyses: PastPaperAnalysis[] = []
        for (const file of files) {
          // Stored like any PDF (no library entry): only its chunks are needed for the call.
          const paper = await deps.library.importPdf(file)
          const analysis = await services.ledger.run(docId, (ai) =>
            ai.mapPastPaper({ topics, paper: paper.chunks, language: services.material.language(doc) })
          )
          analyses.push(analysis)
          for (const q of analysis.questions) {
            const id = q.topicKey === null ? undefined : keyOf.get(q.topicKey)
            if (id === undefined) unmapped++
            else {
              mapped++
              marks.set(id, (marks.get(id) ?? 0) + Math.max(q.marks, 0.5))
            }
          }
        }
        // The paper's style shapes every generator from now on, even if no question matched a topic.
        const profile = analyses.some((a) => a.questions.length > 0)
          ? db.examProfiles.save(
              profileFromPapers(resolveExamProfile(db, docId), analyses),
              deps.now().toISOString()
            )
          : null
        if (profile) deps.emit('library.changed', { docId })
        if (mapped === 0) return { questionsMapped: 0, unmapped, changes: [], profile }

        const current = new Map(leaves.map((t) => [t.id, t.estimates?.examWeight ?? 0]))
        const next = blendWeights(current, marks)
        const changes = leaves.map((t) => {
          const after = next.get(t.id) ?? 0
          const estimates = t.estimates
          if (estimates) {
            const share = marks.get(t.id) ?? 0
            const reasons = [
              ...estimates.examWeightReasons.filter((r) => !r.startsWith('Past papers:')),
              `Past papers: ${share > 0 ? `${share} marks` : 'not examined'}`
            ]
            db.topics.updateEstimates(t.id, { ...estimates, examWeight: after, examWeightReasons: reasons })
          }
          return { topicId: t.id, title: t.title, before: current.get(t.id) ?? 0, after }
        })
        services.planner.replanIfSaved(docId)
        return { questionsMapped: mapped, unmapped, changes, profile }
      }
    }
  }
}
