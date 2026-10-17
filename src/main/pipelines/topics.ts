import type { DocId, JobInfo, PageNotes } from '@shared/domain'
import type { PageDigest, TopicDraft } from '../ai/types'
import type { NewTopic } from '../db/types'
import type { JobContext } from '../jobs/types'
import { hasTextLayer } from '../library'
import { fatal } from './errors'
import type { Material } from './material'
import { parsePayload, topicMapPayload, type TopicMapPayload } from './payloads'
import { PRIORITY } from './priorities'
import { requireDoc } from './scope'
import type { Handlers, PipelineDeps } from './types'
import type { UsageLedger } from './usage'

/**
 * Topic map: one text-only smart-tier call over page digests and the outline. Minutes are
 * calibrated to the user's measured reading speed; items generated before the map are attached
 * to topics by the repository (by first source page).
 */
export interface Topics {
  handlers: Pick<Handlers, 'topics.list' | 'topics.rebuild'>
  enqueue(docId: DocId, priority: number): JobInfo
  runJob(payload: unknown, ctx: JobContext): Promise<void>
}

/** Seconds per page the AI's minute estimates assume for an average student. */
export const BASELINE_SECONDS_PER_PAGE = 90
const MIN_SPEED_FACTOR = 0.5
const MAX_SPEED_FACTOR = 2

/** Multiplier for minute estimates from the user's reading speed; 1 without enough data. */
export function readingSpeedFactor(averageSecondsPerPage: number | null): number {
  if (averageSecondsPerPage === null || !Number.isFinite(averageSecondsPerPage) || averageSecondsPerPage <= 0)
    return 1
  return Math.min(
    MAX_SPEED_FACTOR,
    Math.max(MIN_SPEED_FACTOR, averageSecondsPerPage / BASELINE_SECONDS_PER_PAGE)
  )
}

/** Digest of one indexed page; charCount and hasTextLayer are derived from the stored text as at import. */
export function toDigest(notes: PageNotes, text: string): PageDigest {
  return {
    page: notes.page,
    kind: notes.kind ?? 'other',
    summary: notes.summary ?? '',
    keyPoints: notes.keyPoints,
    conceptTerms: notes.concepts.map((c) => c.term),
    formulaCount: notes.formulas.length,
    examSignals: notes.examSignals,
    charCount: text.length,
    hasTextLayer: hasTextLayer(text)
  }
}

export function toNewTopic(draft: TopicDraft, speedFactor: number): NewTopic {
  const minutes = (m: number): number => Math.max(1, Math.round(m * speedFactor))
  return {
    key: draft.key,
    parentKey: draft.parentKey,
    title: draft.title,
    pageStart: draft.pageStart,
    pageEnd: draft.pageEnd,
    objectives: draft.objectives,
    estimates: {
      difficulty: draft.difficulty,
      examWeight: draft.examWeight,
      examWeightReasons: draft.examWeightReasons,
      coreFraction: draft.coreFraction,
      coreMinutes: minutes(draft.coreMinutes),
      fullMinutes: minutes(Math.max(draft.coreMinutes, draft.fullMinutes)),
      prerequisites: draft.prerequisiteKeys
    }
  }
}

export function createTopics(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'emit'>,
  services: {
    ledger: UsageLedger
    material: Material
    /** Topic ids changed: re-solve a saved plan so it does not point at removed topics. */
    onTopicsReplaced(docId: DocId): void
  }
): Topics {
  const { db, queue } = deps

  const enqueue: Topics['enqueue'] = (docId, priority) =>
    queue.enqueue<TopicMapPayload>({
      kind: 'topic_map',
      docId,
      payload: { docId },
      priority,
      dedupeKey: `topics:${docId}`,
      label: 'Building the course map'
    })

  return {
    enqueue,

    async runJob(raw, ctx) {
      const { docId } = parsePayload(topicMapPayload, raw)
      const doc = db.documents.get(docId)
      if (!doc) return
      const pageText = services.material.pageText(docId)
      const pages = db.pages
        .notesInRange(docId, 1, doc.pageCount)
        .filter((n) => n.indexed)
        .map((n) => toDigest(n, pageText(n.page)))
      if (pages.length === 0) throw fatal('No indexed pages yet: run the index pass first')
      const drafts = await services.ledger.run(docId, (ai) =>
        ai.buildTopicMap({
          title: doc.title,
          outline: doc.outline,
          pages,
          language: services.material.language(doc),
          signal: ctx.signal
        })
      )
      if (drafts.length === 0) throw fatal('The model returned no topics')
      if (!db.documents.get(docId)) return
      const factor = readingSpeedFactor(db.reading.averageSecondsPerPage(docId))
      db.topics.replaceAll(
        docId,
        drafts.map((d) => toNewTopic(d, factor))
      )
      services.onTopicsReplaced(docId)
      deps.emit('library.changed', { docId })
    },

    handlers: {
      'topics.list': async ({ docId }) => {
        requireDoc(db, docId)
        return db.topics.list(docId)
      },
      'topics.rebuild': async ({ docId }) => {
        requireDoc(db, docId)
        return { jobId: enqueue(docId, PRIORITY.requested).id }
      }
    }
  }
}
