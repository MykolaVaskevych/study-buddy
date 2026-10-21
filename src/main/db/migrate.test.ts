import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import BetterSqlite3 from 'better-sqlite3'
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from 'drizzle-kit/api'
import { openDatabase } from './index'
import { migrate, MigrationError, userVersion } from './migrate'
import { MIGRATIONS } from './migrations'
import * as schema from './schema'
import { newDocument } from './test-helpers'
import { readDrizzleFolder } from './tools/drizzle-folder'

const drizzleDir = resolve(import.meta.dirname, '../../../drizzle')

describe('embedded migrations', () => {
  it('match the SQL generated under drizzle/ (run tools/embed-migrations.ts after drizzle-kit generate)', () => {
    expect(MIGRATIONS).toEqual(readDrizzleFolder(drizzleDir))
  })

  it('schema.ts has no changes missing from drizzle/ (run drizzle-kit generate)', async () => {
    const journal = JSON.parse(readFileSync(join(drizzleDir, 'meta/_journal.json'), 'utf8')) as {
      entries: { tag: string }[]
    }
    const lastTag = journal.entries.at(-1)?.tag ?? ''
    const prefix = lastTag.split('_')[0] ?? ''
    const snapshot = JSON.parse(readFileSync(join(drizzleDir, `meta/${prefix}_snapshot.json`), 'utf8'))
    const current = await generateSQLiteDrizzleJson({ ...schema })
    expect(await generateSQLiteMigration(snapshot, current)).toEqual([])
  })
})

describe('migrate()', () => {
  it('creates the schema on a fresh database and records the version', () => {
    const sqlite = new BetterSqlite3(':memory:')
    expect(migrate(sqlite, MIGRATIONS)).toEqual({ from: 0, to: MIGRATIONS.length })
    expect(userVersion(sqlite)).toBe(MIGRATIONS.length)
    const tables = sqlite
      .prepare<[], { name: string }>("select name from sqlite_master where type in ('table') order by name")
      .all()
      .map((t) => t.name)
    expect(tables).toEqual(
      expect.arrayContaining(['documents', 'pages', 'pages_fts', 'cards', 'jobs', 'usage'])
    )
    // Second run is a no-op.
    expect(migrate(sqlite, MIGRATIONS)).toEqual({ from: MIGRATIONS.length, to: MIGRATIONS.length })
    sqlite.close()
  })

  it('rolls a failing migration back and keeps the previous version', () => {
    const sqlite = new BetterSqlite3(':memory:')
    const broken = [
      ...MIGRATIONS,
      { tag: '9999_broken', statements: ['CREATE TABLE extra (id integer)', 'THIS IS NOT SQL'] }
    ]
    expect(() => migrate(sqlite, broken)).toThrow(MigrationError)
    expect(userVersion(sqlite)).toBe(MIGRATIONS.length)
    const extra = sqlite.prepare("select name from sqlite_master where name = 'extra'").get()
    expect(extra).toBeUndefined()
    expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1)
    sqlite.close()
  })

  it('refuses a database written by a newer app version', () => {
    const sqlite = new BetterSqlite3(':memory:')
    sqlite.pragma(`user_version = ${MIGRATIONS.length + 1}`)
    expect(() => migrate(sqlite, MIGRATIONS)).toThrow(/newer than this app/)
    sqlite.close()
  })

  it('a table rebuild with foreign keys does not cascade-delete child rows', () => {
    // drizzle-kit rebuilds tables via DROP + RENAME; foreign keys must be off while that happens.
    const sqlite = new BetterSqlite3(':memory:')
    migrate(sqlite, MIGRATIONS)
    sqlite.pragma('foreign_keys = ON')
    sqlite.exec(`insert into documents (id, sha256, title, stored_path, page_count, outline, imported_at)
                 values ('d1', 'x', 't', '/p', 1, '[]', '2026-01-01T00:00:00.000Z')`)
    sqlite.exec(
      `insert into pages (doc_id, page, text, char_count, has_text_layer) values ('d1', 1, 'hi', 2, 1)`
    )
    // Same shape as drizzle-kit's generated rebuild: new table, copy, drop old, rename.
    const ddl = MIGRATIONS[0]?.statements.find((s) => s.startsWith('CREATE TABLE `documents`')) ?? ''
    const rebuild = {
      tag: '0099_rebuild_documents',
      statements: [
        ddl.replace('CREATE TABLE `documents`', 'CREATE TABLE `__new_documents`'),
        // The columns of the original table (later migrations added more).
        'INSERT INTO `__new_documents` SELECT id, sha256, title, stored_path, page_count, outline, language, imported_at, last_opened_at, last_page, index_state, index_error FROM `documents`',
        'DROP TABLE `documents`',
        'ALTER TABLE `__new_documents` RENAME TO `documents`'
      ]
    }
    expect(ddl).not.toBe('')
    migrate(sqlite, [...MIGRATIONS, rebuild])
    expect(sqlite.prepare('select count(*) as n from pages').get()).toEqual({ n: 1 })
    sqlite.close()
  })
})

describe('openDatabase()', () => {
  it('uses WAL and foreign keys on a file database and keeps data across reopen', () => {
    const dir = mkdtempSync(join(tmpdir(), 'sb-db-'))
    try {
      const file = join(dir, 'study.db')
      const first = openDatabase(file)
      const { id } = first.documents.upsert(newDocument())
      first.close()

      const raw = new BetterSqlite3(file)
      expect(raw.pragma('journal_mode', { simple: true })).toBe('wal')
      expect(userVersion(raw)).toBe(MIGRATIONS.length)
      raw.close()

      const second = openDatabase(file)
      expect(second.documents.get(id)?.title).toBe('Optical Networks')
      second.close()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('transaction() rolls back every write when the callback throws', () => {
    const db = openDatabase(':memory:')
    expect(() =>
      db.transaction(() => {
        db.documents.upsert(newDocument())
        throw new Error('boom')
      })
    ).toThrow('boom')
    expect(db.documents.list()).toEqual([])
    db.close()
  })
})
