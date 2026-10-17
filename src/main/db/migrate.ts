import type BetterSqlite3 from 'better-sqlite3'

/** One migration from drizzle/, embedded as statements so the packaged app needs no SQL files on disk. */
export interface EmbeddedMigration {
  tag: string
  statements: readonly string[]
}

export class MigrationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'MigrationError'
  }
}

/**
 * Applies pending migrations, tracking progress in `PRAGMA user_version` (= number of applied
 * migrations). Each migration runs in its own transaction, so a failing one leaves the database at
 * the previous version.
 *
 * Foreign keys are switched OFF while migrating (the pragma is a no-op inside a transaction, so it is
 * done around it). drizzle-kit implements many SQLite ALTERs as "create new table, copy, DROP old,
 * rename"; with foreign keys ON, that DROP would cascade-delete every child row. Integrity is
 * re-checked with `foreign_key_check` before each commit instead. Note for future migrations: if
 * drizzle-kit rebuilds `pages`, the FTS triggers from 0001 are dropped with it and must be recreated in
 * the same migration.
 *
 * Refuses to open a database written by a newer app version rather than guessing.
 */
export function migrate(
  sqlite: BetterSqlite3.Database,
  migrations: readonly EmbeddedMigration[]
): { from: number; to: number } {
  const from = userVersion(sqlite)
  if (from > migrations.length) {
    throw new MigrationError(
      `Database schema version ${from} is newer than this app supports (${migrations.length}). ` +
        'Update Study Buddy to open this library.'
    )
  }
  if (from === migrations.length) return { from, to: from }

  sqlite.pragma('foreign_keys = OFF')
  try {
    for (let version = from; version < migrations.length; version++) {
      const migration = migrations[version]
      if (!migration) break
      const apply = sqlite.transaction(() => {
        for (const statement of migration.statements) sqlite.exec(statement)
        const violations = sqlite.pragma('foreign_key_check')
        if (Array.isArray(violations) && violations.length > 0) {
          throw new MigrationError(
            `Migration ${migration.tag} left ${violations.length} foreign key violations`
          )
        }
        sqlite.pragma(`user_version = ${version + 1}`)
      })
      try {
        apply()
      } catch (err) {
        if (err instanceof MigrationError) throw err
        throw new MigrationError(`Migration ${migration.tag} failed: ${errorMessage(err)}`, { cause: err })
      }
    }
  } finally {
    sqlite.pragma('foreign_keys = ON')
  }
  return { from, to: migrations.length }
}

export function userVersion(sqlite: BetterSqlite3.Database): number {
  const value: unknown = sqlite.pragma('user_version', { simple: true })
  return typeof value === 'number' ? value : 0
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
