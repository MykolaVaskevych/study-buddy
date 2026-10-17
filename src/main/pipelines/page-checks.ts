import type { DocId, Question, QuizMode, QuizSession, Scope } from '@shared/domain'
import type { Database } from '../db/types'
import { messageOf } from './errors'
import type { Indexing } from './indexing'
import type { JobWaiter } from './job-waiter'
import { PRIORITY } from './priorities'
import { PAGE_CHECK_MIN_REUSE, type QuestionGen } from './questions'
import { requireDoc, requirePage } from './scope'
import type { PipelineDeps } from './types'
import { ServiceError } from './types'

/**
 * "Read a page → test me". Instant when the check was prefetched while the user read; otherwise the
 * page is indexed (if needed) and a page check generated at top priority while the request waits.
 */
export interface PageChecks {
  pageCheck(docId: DocId, page: number): Promise<QuizSession>
  /** Called after reading time was added to a page: prefetch once the page crosses the threshold. */
  maybePrefetch(docId: DocId, page: number, secondsBefore: number, secondsAfter: number): void
}

/** Reading a page this long means the user is studying it: prefetch its check. */
export const PREFETCH_AFTER_SECONDS = 20

export const NOTHING_TO_TEST = 'Nothing to test on this page — try the next one'

/** Stores a quiz over the given questions and returns it as a session. */
export function createSession(
  db: Database,
  now: string,
  quiz: { docId: DocId; mode: QuizMode; scope: Scope; questions: Question[]; timeLimit: number | null }
): QuizSession {
  const id = db.quizzes.create(
    {
      docId: quiz.docId,
      mode: quiz.mode,
      scope: quiz.scope,
      questionIds: quiz.questions.map((q) => q.id),
      timeLimit: quiz.timeLimit
    },
    now
  )
  return { id, ...quiz, createdAt: now }
}

export function createPageChecks(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'emit' | 'now'>,
  services: { indexing: Indexing; questionGen: QuestionGen; waiter: JobWaiter }
): PageChecks {
  const { db } = deps
  const { indexing, questionGen, waiter } = services

  return {
    async pageCheck(docId, page) {
      requirePage(requireDoc(db, docId), page)
      const notes = await indexing.ensurePage(docId, page)
      if (notes.indexed && !notes.teachable) throw new ServiceError('validation', NOTHING_TO_TEST)
      let questions = questionGen.freshPageCheck(docId, page)
      if (questions.length < PAGE_CHECK_MIN_REUSE) {
        await waiter.done(questionGen.enqueuePageCheck(docId, page, PRIORITY.focus).id)
        questions = questionGen.freshPageCheck(docId, page)
      }
      // Asked again soon after a check and nothing new came back (new questions are de-duplicated
      // against old ones): the user asked to be tested, so repeat the least recently answered.
      if (questions.length === 0) questions = questionGen.anyPageCheck(docId, page)
      if (questions.length === 0) throw new ServiceError('validation', NOTHING_TO_TEST)
      return createSession(db, deps.now().toISOString(), {
        docId,
        mode: 'page_check',
        scope: { kind: 'page', docId, page },
        questions,
        timeLimit: null
      })
    },

    maybePrefetch(docId, page, secondsBefore, secondsAfter) {
      // Only on the crossing: tracking repeats every few seconds, and re-reading a checked page later
      // should not generate a new set.
      if (secondsBefore >= PREFETCH_AFTER_SECONDS || secondsAfter < PREFETCH_AFTER_SECONDS) return
      if (!db.settings.get().prefetchPageChecks) return
      const notes = db.pages.notes(docId, page)
      if (!notes?.indexed || !notes.teachable) return
      if (questionGen.freshPageCheck(docId, page).length >= PAGE_CHECK_MIN_REUSE) return
      const job = questionGen.enqueuePageCheck(docId, page, PRIORITY.prefetch)
      deps.queue.wait(job.id).then(
        (info) => {
          if (info.state === 'done' && questionGen.freshPageCheck(docId, page).length > 0) {
            deps.emit('pageCheck.ready', { docId, page })
          }
        },
        (err: unknown) => console.warn(`[pipelines] page check prefetch for p. ${page}: ${messageOf(err)}`)
      )
    }
  }
}
