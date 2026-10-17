import type BetterSqlite3 from 'better-sqlite3'
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'

export type Drizzle = BetterSQLite3Database

/** Everything a repository needs. Clock and id generator are injected so tests are deterministic. */
export interface RepoContext {
  db: Drizzle
  sqlite: BetterSqlite3.Database
  now: () => Date
  newId: () => string
  /** better-sqlite3 transaction (savepoint when nested). `fn` must be synchronous. */
  tx: <T>(fn: () => T) => T
}

export class NotFoundError extends Error {
  constructor(what: string, id: string) {
    super(`${what} not found: ${id}`)
    this.name = 'NotFoundError'
  }
}

/**
 * Normalises any ISO-8601 input to `toISOString()` form. All stored timestamps use this exact format,
 * which is what makes plain string comparison in SQL (`due <= ?`) equal to time comparison.
 */
export function iso(value: string | Date): string {
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) throw new RangeError(`Invalid date: ${String(value)}`)
  return date.toISOString()
}

/** Unique, ascending, positive integer page list (pages are 1-based absolute). */
export function normalisePages(pages: readonly number[]): number[] {
  return [...new Set(pages.filter((p) => Number.isInteger(p) && p >= 1))].sort((a, b) => a - b)
}

/** Clamp a caller-provided limit so a bad value can't turn into a full-table read or a SQL error. */
export function clampLimit(limit: number, max = 10_000): number {
  if (!Number.isFinite(limit)) return max
  return Math.min(max, Math.max(0, Math.floor(limit)))
}
