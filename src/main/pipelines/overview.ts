import type { BookOverview, DocId, TopicId } from '@shared/domain'
import type { Indexing } from './indexing'
import type { Planner } from './planner'
import { ACTIVE_JOB_STATES, JOB_SCAN_LIMIT, PRIORITY } from './priorities'
import { leafTopics, leavesUnder, requireDoc } from './scope'
import type { Topics } from './topics'
import { ServiceError, type Handlers, type PipelineDeps } from './types'

/** Pages with at least this many active page-check questions count as "ready to test". */
const PAGE_CHECK_READY = 3

/**
 * The book overview (what the AI has prepared, what the student has done), "Prepare everything",
 * progress reset, and the student's bookmarks and notes.
 */
export function createOverview(
  deps: Pick<PipelineDeps, 'db' | 'emit' | 'now'>,
  services: {
    indexing: Indexing
    topics: Topics
    planner: Planner
    generateCards: Handlers['cards.generate']
  }
): {
  handlers: Pick<
    Handlers,
    | 'library.overview'
    | 'library.prepare'
    | 'progress.reset'
    | 'annotations.list'
    | 'annotations.save'
    | 'annotations.delete'
  >
  /** Called when a course map is (re)built: continues a pending "Prepare everything". */
  onTopicsReady(docId: DocId): void
} {
  const { db } = deps
  /** Books whose "Prepare everything" waits for indexing or the course map before queueing cards. */
  const pending = new Set<DocId>()

  const activeJobs = (docId: DocId) =>
    db.jobs.list(docId, JOB_SCAN_LIMIT).filter((j) => ACTIVE_JOB_STATES.has(j.state))

  /** Essentials decks for every leaf topic the plan does not skip and that has none yet. */
  async function queueCards(docId: DocId): Promise<number> {
    const plan = db.plans.get(docId)
    const skipped = new Set(plan?.result.items.filter((i) => i.level === 'skip').map((i) => i.topicId) ?? [])
    let queued = 0
    for (const t of leafTopics(db.topics.list(docId))) {
      if (skipped.has(t.id)) continue
      const hasEssentials = db.cards
        .list({ kind: 'topic', docId, topicId: t.id }, true)
        .some((c) => c.essential)
      if (hasEssentials) continue
      await services.generateCards({
        scope: { kind: 'topic', docId, topicId: t.id },
        essentialsOnly: true,
        count: null
      })
      queued++
    }
    return queued
  }

  return {
    onTopicsReady(docId) {
      if (!pending.delete(docId)) return
      void queueCards(docId).catch((err: unknown) => console.warn('[pipelines] prepare: cards failed', err))
    },

    handlers: {
      async 'library.overview'({ docId }): Promise<BookOverview> {
        const doc = requireDoc(db, docId)
        const now = deps.now().toISOString()
        const all = db.topics.list(docId)
        const leaves = leafTopics(all)
        const jobs = activeJobs(docId)
        const cards = db.cards.list({ kind: 'document', docId }, false)
        const covered = new Set(cards.filter((c) => c.essential && c.topicId !== null).map((c) => c.topicId))
        const checks = db.questions.list(
          { kind: 'document', docId },
          { purpose: 'page_check', includeInactive: false }
        )
        const perPage = new Map<number, number>()
        for (const q of checks) {
          const p = q.sourcePages[0]
          if (p !== undefined) perPage.set(p, (perPage.get(p) ?? 0) + 1)
        }
        const plan = db.plans.get(docId)
        const stats = db.progress.stats(docId)
        return {
          docId,
          title: doc.title,
          pageCount: doc.pageCount,
          index: doc.index,
          topics: {
            state:
              all.length > 0 ? 'ready' : jobs.some((j) => j.kind === 'topic_map') ? 'building' : 'waiting',
            count: leaves.length
          },
          plan: {
            saved: plan !== null,
            examDate: plan?.input.examDate ?? null,
            expectedScore: plan?.result.expectedScore ?? null
          },
          cards: {
            total: cards.length,
            due: db.cards.stats(docId, now).due,
            topicsCovered: leaves.filter((t) => covered.has(t.id)).length,
            topicsTotal: leaves.length
          },
          questions: {
            total: db.questions.list({ kind: 'document', docId }, { purpose: 'any', includeInactive: false })
              .length,
            pageChecksReady: [...perPage.values()].filter((n) => n >= PAGE_CHECK_READY).length
          },
          studyBook: {
            written: db.lessons.list(docId).filter((l) => leaves.some((t) => t.id === l.topicId)).length,
            topicsTotal: leaves.length
          },
          progress: {
            pagesRead: stats.pagesRead,
            minutesRead: Math.round(stats.secondsRead / 60),
            reviews: stats.reviews,
            quizzes: stats.quizzesFinished,
            mastery: doc.mastery
          },
          jobs,
          preparing: pending.has(docId) || jobs.some((j) => j.kind === 'generate_cards')
        }
      },

      async 'library.prepare'({ docId }) {
        const doc = requireDoc(db, docId)
        if (doc.index.state !== 'done') {
          pending.add(docId)
          await services.indexing.start(docId)
          return {
            queued: 1,
            message: 'Reading the book first. The course map and flashcards follow automatically.'
          }
        }
        if (db.topics.list(docId).length === 0) {
          pending.add(docId)
          services.topics.enqueue(docId, PRIORITY.requested)
          return { queued: 1, message: 'Building the course map. Flashcards follow automatically.' }
        }
        const queued = await queueCards(docId)
        return {
          queued,
          message:
            queued === 0
              ? 'Everything is already prepared.'
              : `Making essentials flashcards for ${queued} topic${queued === 1 ? '' : 's'}.`
        }
      },

      async 'progress.reset'({ docId, topicId }) {
        requireDoc(db, docId)
        let scope: { topicIds: TopicId[]; ranges: { from: number; to: number }[] } | null = null
        if (topicId !== null) {
          const all = db.topics.list(docId)
          const root = all.find((t) => t.id === topicId)
          if (!root) throw new ServiceError('not_found', `Topic ${topicId} not found`)
          const below = new Set([root.id, ...leavesUnder(all, root.id).map((t) => t.id)])
          // Chapters too: everything whose parent chain reaches the root.
          for (let grew = true; grew;) {
            grew = false
            for (const t of all)
              if (t.parentId !== null && below.has(t.parentId) && !below.has(t.id)) {
                below.add(t.id)
                grew = true
              }
          }
          scope = { topicIds: [...below], ranges: [{ from: root.pageStart, to: root.pageEnd }] }
        }
        const result = db.progress.reset(docId, scope, deps.now().toISOString())
        services.planner.replanIfSaved(docId)
        deps.emit('cards.changed', { docId })
        deps.emit('library.changed', { docId })
        return result
      },

      async 'annotations.list'({ docId }) {
        requireDoc(db, docId)
        return db.annotations.list(docId)
      },

      async 'annotations.save'({ docId, page, kind, text }) {
        const doc = requireDoc(db, docId)
        if (page > doc.pageCount)
          throw new ServiceError('validation', `Page ${page} is past the end of the book`)
        return db.annotations.upsert({ docId, page, kind, text }, deps.now().toISOString())
      },

      async 'annotations.delete'({ docId, page, kind }) {
        requireDoc(db, docId)
        db.annotations.remove(docId, page, kind)
        return { ok: true }
      }
    }
  }
}
