import { and, desc, eq, gte, lt, sql } from 'drizzle-orm'
import type { UsageSummary } from '@shared/domain'
import { iso, type RepoContext } from '../context'
import { usage } from '../schema'
import type { UsageRepo } from '../types'

/**
 * "Today" and "this month" are the user's LOCAL calendar day/month. Rows store UTC instants, so the
 * local boundaries are converted to UTC instants and compared as ISO strings. The Date constructor
 * with local fields handles DST and month lengths.
 */
export function localDayRange(now: Date): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  const d = now.getDate()
  return { from: new Date(y, m, d).toISOString(), to: new Date(y, m, d + 1).toISOString() }
}

export function localMonthRange(now: Date): { from: string; to: string } {
  const y = now.getFullYear()
  const m = now.getMonth()
  return { from: new Date(y, m, 1).toISOString(), to: new Date(y, m + 1, 1).toISOString() }
}

const cost = sql<number>`coalesce(sum(coalesce(${usage.costUsd}, 0)), 0)`
const inRange = (r: { from: string; to: string }) =>
  and(gte(usage.createdAt, r.from), lt(usage.createdAt, r.to))

export function createUsageRepo(ctx: RepoContext): UsageRepo {
  const { db } = ctx

  return {
    record(entry, now) {
      const u = entry.usage
      db.insert(usage)
        .values({
          task: entry.task,
          model: entry.model,
          provider: entry.provider,
          docId: entry.docId,
          inputTokens: u.inputTokens,
          outputTokens: u.outputTokens,
          cacheReadTokens: u.cacheReadTokens,
          cacheWriteTokens: u.cacheWriteTokens,
          costUsd: u.costUsd,
          notional: u.notional,
          createdAt: iso(now)
        })
        .run()
    },

    summary(now): UsageSummary {
      const at = new Date(now)
      const month = localMonthRange(at)
      const byTask = db
        .select({
          task: usage.task,
          usd: cost,
          calls: sql<number>`count(*)`,
          real: sql<number>`coalesce(sum(case when ${usage.notional} then 0 else 1 end), 0)`
        })
        .from(usage)
        .where(inRange(month))
        .groupBy(usage.task)
        .orderBy(desc(cost), usage.task)
        .all()
      const today = db
        .select({ usd: cost })
        .from(usage)
        .where(inRange(localDayRange(at)))
        .get()
      return {
        // Vacuously true for an empty month: nothing has been billed.
        notional: byTask.every((t) => t.real === 0),
        todayUsd: today?.usd ?? 0,
        monthUsd: byTask.reduce((sum, t) => sum + t.usd, 0),
        byTask: byTask.map(({ task, usd, calls }) => ({ task, usd, calls }))
      }
    },

    monthSpendUsd(now) {
      // Only billed (non-notional) cost counts against the monthly budget cap.
      const row = db
        .select({ usd: cost })
        .from(usage)
        .where(and(inRange(localMonthRange(new Date(now))), eq(usage.notional, false)))
        .get()
      return row?.usd ?? 0
    }
  }
}
