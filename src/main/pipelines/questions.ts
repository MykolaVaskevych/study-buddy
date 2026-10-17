import type { DocId, JobInfo, Question, Scope } from '@shared/domain'
import type { QuestionDraft } from '../ai/types'
import type { QuestionPurpose } from '../db/types'
import type { JobContext } from '../jobs/types'
import { fatal } from './errors'
import { topicForPages } from './learning'
import type { Material } from './material'
import {
  generateQuestionsPayload,
  pageCheckPayload,
  parsePayload,
  type GenerateQuestionsPayload,
  type PageCheckPayload
} from './payloads'
import {
  pagesIn,
  resolveJobScope,
  resolveScope,
  scopeKey,
  scopeLabel,
  type DocRecord,
  type PageRange
} from './scope'
import { distribute, isContinuation, pickFresh } from './selection'
import type { PipelineDeps } from './types'
import type { UsageLedger } from './usage'

/**
 * Question generation jobs: `generate_questions` (topic quizzes and mock exams, split into windows)
 * and `page_check` (a few quick questions on the page just read, from a focus chunk).
 */
export interface QuestionGen {
  runGenerate(payload: unknown, ctx: JobContext): Promise<void>
  runPageCheck(payload: unknown, ctx: JobContext): Promise<void>
  enqueueQuestions(payload: GenerateQuestionsPayload, priority: number): JobInfo
  enqueuePageCheck(docId: DocId, page: number, priority: number): JobInfo
  /** Pages a check of `page` covers: [page − 1, page] when the previous page continues onto it. */
  pageCheckRange(docId: DocId, page: number): PageRange
  /** Unanswered (or long-unanswered) active page-check questions for the page, best first. */
  freshPageCheck(docId: DocId, page: number): Question[]
  /** Every active page-check question for the page, least recently answered first. */
  anyPageCheck(docId: DocId, page: number): Question[]
}

/** Questions per page check. */
export const PAGE_CHECK_COUNT = 4
/** A page check reuses stored questions when at least this many are fresh. */
export const PAGE_CHECK_MIN_REUSE = 3

export function rangeScope(docId: DocId, range: PageRange): Scope {
  return range.from === range.to
    ? { kind: 'page', docId, page: range.from }
    : { kind: 'range', docId, from: range.from, to: range.to }
}

export function createQuestionGen(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'now'>,
  services: { ledger: UsageLedger; material: Material }
): QuestionGen {
  const { db, queue } = deps
  const { ledger, material } = services

  /** Stores drafts with their topic; returns how many were stored. */
  const store = (docId: DocId, drafts: readonly QuestionDraft[], purpose: QuestionPurpose): number => {
    if (drafts.length === 0 || !db.documents.get(docId)) return 0
    db.questions.insertMany(
      drafts.map((d) => ({ ...d, docId, topicId: topicForPages(db, docId, d.sourcePages), fromBook: false })),
      deps.now().toISOString(),
      purpose
    )
    return drafts.length
  }

  const generate = async (
    doc: DocRecord,
    range: PageRange,
    opts: { count: number; types: GenerateQuestionsPayload['types']; purpose: QuestionPurpose },
    signal: AbortSignal
  ): Promise<number> => {
    const ctx = await material.context(doc, range, signal)
    const drafts = await ledger.run(doc.id, (ai) =>
      ai.generateQuestions(ctx, {
        count: opts.count,
        types: opts.types,
        purpose: opts.purpose,
        existingStems: db.questions.stems(doc.id),
        verify: db.settings.get().verifyAnswerKeys
      })
    )
    return store(doc.id, drafts, opts.purpose)
  }

  const pageCheckRange: QuestionGen['pageCheckRange'] = (docId, page) => {
    if (page <= 1) return { from: page, to: page }
    const text = material.pageText(docId)
    const continues = isContinuation({
      prev: db.pages.notes(docId, page - 1),
      cur: db.pages.notes(docId, page),
      prevText: text(page - 1),
      curText: text(page),
      sameTopic:
        (db.topics.forPage(docId, page - 1)?.id ?? null) === (db.topics.forPage(docId, page)?.id ?? null)
    })
    return continues ? { from: page - 1, to: page } : { from: page, to: page }
  }

  const pageCheckQuestions = (docId: DocId, page: number): Question[] =>
    db.questions.list(rangeScope(docId, pageCheckRange(docId, page)), {
      purpose: 'page_check',
      includeInactive: false
    })

  return {
    pageCheckRange,

    freshPageCheck(docId, page) {
      const list = pageCheckQuestions(docId, page)
      const answered = db.quizzes.lastAttemptAt(list.map((q) => q.id))
      return pickFresh(list, answered, deps.now(), { limit: PAGE_CHECK_COUNT })
    },

    anyPageCheck(docId, page) {
      const list = pageCheckQuestions(docId, page)
      const answered = db.quizzes.lastAttemptAt(list.map((q) => q.id))
      return [...list]
        .sort((a, b) => (answered.get(a.id) ?? '').localeCompare(answered.get(b.id) ?? ''))
        .slice(0, PAGE_CHECK_COUNT)
    },

    enqueueQuestions(payload, priority) {
      const resolved = resolveScope(db, payload.scope)
      const what = payload.purpose === 'mock' ? 'Mock exam questions' : 'Quiz questions'
      return queue.enqueue<GenerateQuestionsPayload>({
        kind: 'generate_questions',
        docId: payload.scope.docId,
        payload,
        priority,
        dedupeKey: `questions:${scopeKey(payload.scope)}:${payload.purpose}:${(payload.types ?? []).join(',')}`,
        label: `${what} for ${scopeLabel(resolved)}`
      })
    },

    enqueuePageCheck(docId, page, priority) {
      return queue.enqueue<PageCheckPayload>({
        kind: 'page_check',
        docId,
        payload: { docId, page },
        priority,
        dedupeKey: `page_check:${docId}:${page}`,
        label: `Page check for p. ${page}`
      })
    },

    async runGenerate(raw, ctx) {
      const p = parsePayload(generateQuestionsPayload, raw)
      if (!db.documents.get(p.scope.docId)) return
      const resolved = resolveJobScope(db, p.scope)
      const windows = material.teachable(
        resolved.doc.id,
        await material.windows(resolved, p.scope.kind === 'document')
      )
      if (windows.length === 0) throw fatal(`Nothing to ask about in ${scopeLabel(resolved)}`)
      const counts = distribute(p.count, windows.map(pagesIn))
      let stored = 0
      for (const [i, window] of windows.entries()) {
        const count = counts[i] ?? 0
        if (count <= 0) continue
        ctx.progress(i / windows.length)
        stored += await generate(
          resolved.doc,
          window,
          { count, types: p.types, purpose: p.purpose },
          ctx.signal
        )
      }
      if (stored === 0) throw fatal(`No usable questions came back for ${scopeLabel(resolved)}`)
    },

    async runPageCheck(raw, ctx) {
      const { docId, page } = parsePayload(pageCheckPayload, raw)
      const doc = db.documents.get(docId)
      if (!doc || page > doc.pageCount) return
      const notes = db.pages.notes(docId, page)
      // Title, contents or blank page: no call. quiz.pageCheck explains this to the user.
      if (notes?.indexed && !notes.teachable) return
      await generate(
        doc,
        pageCheckRange(docId, page),
        { count: PAGE_CHECK_COUNT, types: null, purpose: 'page_check' },
        ctx.signal
      )
    }
  }
}
