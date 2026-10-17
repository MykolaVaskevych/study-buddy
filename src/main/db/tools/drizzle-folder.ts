import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { EmbeddedMigration } from '../migrate'

/** drizzle-kit's statement separator inside generated .sql files. */
const BREAKPOINT = '--> statement-breakpoint'

interface Journal {
  entries: { idx: number; tag: string }[]
}

function isJournal(value: unknown): value is Journal {
  if (typeof value !== 'object' || value === null || !('entries' in value)) return false
  const entries: unknown = value.entries
  return (
    Array.isArray(entries) &&
    entries.every(
      (e: unknown) =>
        typeof e === 'object' && e !== null && 'idx' in e && 'tag' in e && typeof e.tag === 'string'
    )
  )
}

/**
 * Reads a drizzle-kit migrations folder (meta/_journal.json + <tag>.sql) the same way drizzle's own
 * migrator does, splitting statements at the breakpoints. Dev-time only: used by the embed tool and
 * by the test that keeps migrations.ts in sync with drizzle/.
 */
export function readDrizzleFolder(folder: string): EmbeddedMigration[] {
  const journal: unknown = JSON.parse(readFileSync(join(folder, 'meta', '_journal.json'), 'utf8'))
  if (!isJournal(journal)) throw new Error(`Unexpected journal format in ${folder}`)
  return [...journal.entries]
    .sort((a, b) => a.idx - b.idx)
    .map(({ tag }) => ({
      tag,
      statements: readFileSync(join(folder, `${tag}.sql`), 'utf8')
        .split(BREAKPOINT)
        .map((s) => s.trim())
        .filter((s) => s.length > 0 && !/^(--[^\n]*\n?)*$/.test(s))
    }))
}
