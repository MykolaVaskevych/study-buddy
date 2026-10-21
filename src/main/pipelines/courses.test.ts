import { openTestDb, seedDocument } from '../db/test-helpers'
import { courseNameFor, placeImported } from './courses'

const now = '2026-10-21T10:00:00.000Z'

describe('courseNameFor', () => {
  it('uses the shared folder unless it is generic', () => {
    expect(courseNameFor(['/u/Optical Networks/w1.pptx', '/u/Optical Networks/w2.pdf'], 'Week 1')).toBe(
      'Optical Networks'
    )
    expect(courseNameFor(['/home/me/Downloads/w1.pdf', '/home/me/Downloads/w2.pdf'], 'Week 1')).toBe('Week 1')
    expect(courseNameFor(['/a/x.pdf', '/b/y.pdf'], 'Week 1')).toBe('Week 1')
  })
})

describe('placeImported', () => {
  const setup = () => {
    const { db } = openTestDb()
    const old = seedDocument(db, { sha256: 'a'.repeat(64), title: 'Old notes' })
    db.courses.ensureCourse(old, now)
    const w1 = seedDocument(db, { sha256: 'b'.repeat(64), title: 'Week 1' })
    const w2 = seedDocument(db, { sha256: 'c'.repeat(64), title: 'Week 2' })
    return { db, old, w1, w2 }
  }
  const paths = ['/u/Optics/w1.pdf', '/u/Optics/w2.pdf', '/u/Optics/old.pdf']

  it('groups new files imported together and leaves files already in the library alone', () => {
    const { db, old, w1, w2 } = setup()
    const imported = [
      { id: w1, created: true },
      { id: w2, created: true },
      { id: old, created: false }
    ]
    placeImported(db, imported, { courseId: null, paths, now })
    expect(db.courses.list().map((c) => [c.name, c.docIds])).toEqual([
      ['Old notes', [old]],
      ['Optics', [w1, w2]]
    ])
  })

  it('adds every file to the chosen course', () => {
    const { db, old, w1 } = setup()
    const target = db.courses.list()[0]?.id ?? ''
    placeImported(db, [{ id: w1, created: true }], { courseId: target, paths, now })
    expect(db.courses.get(target)?.docIds).toEqual([old, w1])
  })

  it('gives a single new file its own course', () => {
    const { db, w1 } = setup()
    placeImported(db, [{ id: w1, created: true }], { courseId: null, paths: ['/u/Optics/w1.pdf'], now })
    expect(db.courses.list().map((c) => c.name)).toEqual(['Old notes', 'Week 1'])
  })
})
