import { and, eq, gte, sql } from 'drizzle-orm'
import { iso, type RepoContext } from '../context'
import { reading } from '../schema'
import type { ReadingRepo } from '../types'

/** Pages glanced at for less than this are flips, not reading. */
const MIN_SECONDS_PER_PAGE = 5
/** Fewer read pages than this is too little data to calibrate the planner's reading speed. */
const MIN_PAGES_FOR_AVERAGE = 3
/** A page left open while the user walked away should not count as 2 h of reading. */
const MAX_SECONDS_PER_PAGE = 15 * 60

export function createReadingRepo(ctx: RepoContext): ReadingRepo {
  const { db } = ctx

  return {
    track(docId, page, seconds, now) {
      if (!Number.isFinite(seconds) || seconds <= 0) return
      const updatedAt = iso(now)
      db.insert(reading)
        .values({ docId, page, seconds, updatedAt })
        .onConflictDoUpdate({
          target: [reading.docId, reading.page],
          set: { seconds: sql`${reading.seconds} + ${seconds}`, updatedAt }
        })
        .run()
    },

    secondsOnPage(docId, page) {
      return (
        db
          .select({ seconds: reading.seconds })
          .from(reading)
          .where(and(eq(reading.docId, docId), eq(reading.page, page)))
          .get()?.seconds ?? 0
      )
    },

    averageSecondsPerPage(docId) {
      const row = db
        .select({
          pages: sql<number>`count(*)`,
          avg: sql<number | null>`avg(min(${reading.seconds}, ${MAX_SECONDS_PER_PAGE}))`
        })
        .from(reading)
        .where(and(eq(reading.docId, docId), gte(reading.seconds, MIN_SECONDS_PER_PAGE)))
        .get()
      if (!row || row.pages < MIN_PAGES_FOR_AVERAGE || row.avg === null) return null
      return row.avg
    }
  }
}
