import { iso, type RepoContext } from '../context'
import type { ProgressRepo, ProgressScope } from '../types'

/** Same threshold as the reading repo: shorter visits are page flips, not reading. */
const MIN_SECONDS_PER_PAGE = 5

/**
 * Progress counts for the book overview and the reset. Raw SQL: these are set-based updates over
 * several tables, clearer here than as chains of drizzle queries.
 */
export function createProgressRepo(ctx: RepoContext): ProgressRepo {
  const { sqlite } = ctx

  return {
    stats(docId) {
      const read = sqlite
        .prepare(
          'SELECT count(*) AS pages, coalesce(sum(seconds), 0) AS seconds FROM reading WHERE doc_id = ? AND seconds >= ?'
        )
        .get(docId, MIN_SECONDS_PER_PAGE) as { pages: number; seconds: number }
      const reviews = sqlite
        .prepare(
          'SELECT count(*) AS n FROM card_reviews r JOIN cards c ON c.id = r.card_id WHERE c.doc_id = ?'
        )
        .get(docId) as { n: number }
      const quizzes = sqlite
        .prepare('SELECT count(*) AS n FROM quizzes WHERE doc_id = ? AND finished_at IS NOT NULL')
        .get(docId) as { n: number }
      return {
        pagesRead: read.pages,
        secondsRead: read.seconds,
        reviews: reviews.n,
        quizzesFinished: quizzes.n
      }
    },

    reset(docId, scope: ProgressScope | null, now) {
      const at = iso(now)
      return ctx.tx(() => {
        const topicFilter =
          scope === null ? '' : ` AND topic_id IN (${scope.topicIds.map(() => '?').join(',') || 'NULL'})`
        const topicArgs = scope === null ? [] : scope.topicIds

        const cardIds = (
          sqlite.prepare(`SELECT id FROM cards WHERE doc_id = ?${topicFilter}`).all(docId, ...topicArgs) as {
            id: string
          }[]
        ).map((r) => r.id)
        for (const id of cardIds) sqlite.prepare('DELETE FROM card_reviews WHERE card_id = ?').run(id)
        sqlite
          .prepare(
            `UPDATE cards SET due = ?, stability = 0, difficulty = 0, reps = 0, lapses = 0, srs_state = 'new',
             last_review = NULL, elapsed_days = 0, scheduled_days = 0, learning_steps = 0
             WHERE doc_id = ?${topicFilter}`
          )
          .run(at, docId, ...topicArgs)

        let attempts: number
        if (scope === null) {
          attempts = (
            sqlite
              .prepare(
                'SELECT count(*) AS n FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE q.doc_id = ?'
              )
              .get(docId) as { n: number }
          ).n
          sqlite.prepare('DELETE FROM quizzes WHERE doc_id = ?').run(docId)
        } else {
          attempts = sqlite
            .prepare(
              `DELETE FROM quiz_attempts WHERE question_id IN (SELECT id FROM questions WHERE doc_id = ?${topicFilter})`
            )
            .run(docId, ...topicArgs).changes
        }

        sqlite
          .prepare(
            `UPDATE topics SET mastery_alpha = NULL, mastery_beta = NULL WHERE doc_id = ?${scope === null ? '' : topicFilter.replace('topic_id', 'id')}`
          )
          .run(docId, ...topicArgs)

        let readingPages = 0
        if (scope === null) {
          readingPages = sqlite.prepare('DELETE FROM reading WHERE doc_id = ?').run(docId).changes
        } else {
          const del = sqlite.prepare('DELETE FROM reading WHERE doc_id = ? AND page BETWEEN ? AND ?')
          for (const r of scope.ranges) readingPages += del.run(docId, r.from, r.to).changes
        }
        return { cards: cardIds.length, attempts, readingPages }
      })
    }
  }
}
