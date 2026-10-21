import BetterSqlite3 from 'better-sqlite3'
import { migrate } from '../migrate'
import { MIGRATIONS } from '../migrations'
import { openTestDb, seedDocument } from '../test-helpers'

const now = '2026-10-21T10:00:00.000Z'

function threeFiles() {
  const { db } = openTestDb()
  const a = seedDocument(db, { sha256: 'a'.repeat(64), title: 'Week 1' })
  const b = seedDocument(db, { sha256: 'b'.repeat(64), title: 'Week 2' })
  const c = seedDocument(db, { sha256: 'c'.repeat(64), title: 'Notes' })
  for (const id of [a, b, c]) db.courses.ensureCourse(id, now)
  return { db, a, b, c }
}

describe('CourseRepo', () => {
  it('gives each new file its own course, named after it', () => {
    const { db, a, b, c } = threeFiles()
    expect(db.courses.list().map((x) => [x.name, x.docIds])).toEqual([
      ['Week 1', [a]],
      ['Week 2', [b]],
      ['Notes', [c]]
    ])
    // Idempotent: a file keeps its course.
    expect(db.courses.ensureCourse(a, now)).toBe(db.courses.list()[0]?.id)
  })

  it('creates a course from files and drops the courses they leave empty', () => {
    const { db, a, b, c } = threeFiles()
    const course = db.courses.create('Optical Networks', [b, a], now)
    expect(course).toMatchObject({ name: 'Optical Networks', docIds: [b, a] })
    expect(db.courses.list().map((x) => x.name)).toEqual(['Notes', 'Optical Networks'])
    expect(db.courses.get(course.id)?.docIds).toEqual([b, a])
    expect(db.courses.list()[0]?.docIds).toEqual([c])
  })

  it('moves and reorders files, removing a course when its last file leaves', () => {
    const { db, a, b, c } = threeFiles()
    const course = db.courses.create('Optics', [a, b], now)
    db.courses.moveDocument(c, course.id, 1)
    expect(db.courses.get(course.id)?.docIds).toEqual([a, c, b])
    expect(db.courses.list()).toHaveLength(1)
    db.courses.moveDocument(a, course.id, 99) // reorder within, clamped to the end
    expect(db.courses.get(course.id)?.docIds).toEqual([c, b, a])
  })

  it('renames, reorders and dissolves courses', () => {
    const { db, a, b, c } = threeFiles()
    const course = db.courses.create('Optics', [a, b], now)
    db.courses.rename(course.id, 'Optical Networks')
    db.courses.reorder([course.id])
    expect(db.courses.list().map((x) => x.name)).toEqual(['Optical Networks', 'Notes'])
    db.courses.dissolve(course.id, now)
    expect(db.courses.get(course.id)).toBeNull()
    expect(db.courses.list().map((x) => [x.name, x.docIds])).toEqual([
      ['Notes', [c]],
      ['Week 1', [a]],
      ['Week 2', [b]]
    ])
  })

  it('migrates existing files into one-file courses in import order', () => {
    const sqlite = new BetterSqlite3(':memory:')
    const before = MIGRATIONS.findIndex((m) => m.tag === '0005_courses')
    migrate(sqlite, MIGRATIONS.slice(0, before))
    const insert = sqlite.prepare(
      "insert into documents (id, sha256, title, stored_path, page_count, outline, imported_at) values (?, ?, ?, '/x.pdf', 3, '[]', ?)"
    )
    insert.run('d2', 'b'.repeat(64), 'Wireless', '2026-10-02T00:00:00.000Z')
    insert.run('d1', 'a'.repeat(64), 'Optical', '2026-10-01T00:00:00.000Z')
    migrate(sqlite, MIGRATIONS)
    const rows = sqlite
      .prepare(
        'select c.name, c.ord, d.id from courses c join documents d on d.course_id = c.id order by c.ord'
      )
      .all()
    expect(rows).toEqual([
      { name: 'Optical', ord: 0, id: 'd1' },
      { name: 'Wireless', ord: 1, id: 'd2' }
    ])
    sqlite.close()
  })
})
