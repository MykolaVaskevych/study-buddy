import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import type { RepoContext } from './context'
import { migrate, type EmbeddedMigration } from './migrate'
import { MIGRATIONS } from './migrations'
import { createCardRepo } from './repos/cards'
import { createDocumentRepo } from './repos/documents'
import { createJobRepo } from './repos/jobs'
import { createPageRepo } from './repos/pages'
import { createPlanRepo } from './repos/plans'
import { createQuestionRepo } from './repos/questions'
import { createQuizRepo } from './repos/quizzes'
import { createReadingRepo } from './repos/reading'
import { createSettingsRepo } from './repos/settings'
import { createAnnotationRepo } from './repos/annotations'
import { createProgressRepo } from './repos/progress'
import { createLessonRepo } from './repos/lessons'
import { createTopicRepo } from './repos/topics'
import { createUsageRepo } from './repos/usage'
import type { Database, OpenDatabase } from './types'

export type * from './types'
export { MigrationError } from './migrate'
export { NotFoundError } from './context'

export interface OpenDatabaseOptions {
  /** Clock for timestamps the repositories set themselves (importedAt, lastOpenedAt, ...). */
  now?: () => Date
  /** Id generator; defaults to crypto.randomUUID. */
  newId?: () => string
  /** How long a write waits for a lock held by another connection before failing. */
  busyTimeoutMs?: number
  /** Override the embedded migrations (tests of the migration runner). */
  migrations?: readonly EmbeddedMigration[]
}

const isMemory = (file: string): boolean => file === ':memory:' || file === ''

/**
 * Opens (creating if needed) and migrates the database, then builds every repository.
 * Pragmas: WAL for concurrent reads during background writes (not available for :memory:),
 * synchronous=NORMAL (safe with WAL, much faster), foreign keys ON (cascades are relied upon),
 * busy_timeout so a checkpoint or a second connection does not surface as SQLITE_BUSY.
 */
export function openDatabase(file: string, options: OpenDatabaseOptions = {}): Database {
  const sqlite = new BetterSqlite3(file)
  try {
    if (!isMemory(file)) {
      sqlite.pragma('journal_mode = WAL')
      sqlite.pragma('synchronous = NORMAL')
    }
    sqlite.pragma(`busy_timeout = ${Math.max(0, Math.floor(options.busyTimeoutMs ?? 5000))}`)
    migrate(sqlite, options.migrations ?? MIGRATIONS)
    sqlite.pragma('foreign_keys = ON')

    const ctx: RepoContext = {
      db: drizzle({ client: sqlite }),
      sqlite,
      now: options.now ?? (() => new Date()),
      newId: options.newId ?? randomUUID,
      tx: (fn) => sqlite.transaction(fn)()
    }
    return {
      documents: createDocumentRepo(ctx),
      pages: createPageRepo(ctx),
      topics: createTopicRepo(ctx),
      cards: createCardRepo(ctx),
      questions: createQuestionRepo(ctx),
      quizzes: createQuizRepo(ctx),
      reading: createReadingRepo(ctx),
      plans: createPlanRepo(ctx),
      jobs: createJobRepo(ctx),
      usage: createUsageRepo(ctx),
      settings: createSettingsRepo(ctx),
      annotations: createAnnotationRepo(ctx),
      progress: createProgressRepo(ctx),
      lessons: createLessonRepo(ctx),
      transaction: ctx.tx,
      close: () => {
        if (sqlite.open) sqlite.close()
      }
    }
  } catch (err) {
    sqlite.close()
    throw err
  }
}

// Compile-time check that the wider signature (with options) still satisfies the contract.
const _contract: OpenDatabase = openDatabase
