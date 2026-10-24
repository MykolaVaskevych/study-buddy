import { openTestDb, seedDocument } from '../test-helpers'

const now = '2026-10-24T10:00:00.000Z'

describe('PortalWatchRepo', () => {
  it('persists a JSON baseline, keeps creation idempotent and removes watches', () => {
    const { db } = openTestDb()
    try {
      const courseId = db.courses.ensureCourse(seedDocument(db), now)
      const input = { courseId, url: 'https://portal.edu/course', title: 'Course' }
      const watch = db.portalWatches.create(input, now)
      expect(watch).toMatchObject({ ...input, seenLinks: [], checkedAt: null, createdAt: now })
      db.portalWatches.checked(watch.id, 'Lectures', ['https://portal.edu/a.pdf?x="a"'], now)
      expect(db.portalWatches.create(input, now)).toMatchObject({
        id: watch.id,
        title: 'Lectures',
        checkedAt: now
      })
      expect(db.portalWatches.list()).toEqual([db.portalWatches.get(watch.id)])
      expect(db.portalWatches.get(watch.id)?.seenLinks).toEqual(['https://portal.edu/a.pdf?x="a"'])
      db.portalWatches.remove(watch.id)
      db.portalWatches.remove(watch.id)
      expect(db.portalWatches.list()).toEqual([])
    } finally {
      db.close()
    }
  })

  it('enforces course ownership, allows the same page in two courses and cascades deletions', () => {
    const { db } = openTestDb()
    try {
      const courseId = db.courses.ensureCourse(seedDocument(db), now)
      const other = db.courses.ensureCourse(seedDocument(db, { sha256: 'b'.repeat(64) }), now)
      const input = { courseId, url: 'https://portal.edu/course', title: 'Course' }
      db.portalWatches.create(input, now)
      db.portalWatches.create({ ...input, courseId: other }, now)
      expect(db.portalWatches.list()).toHaveLength(2)
      expect(() => db.portalWatches.create({ ...input, courseId: 'missing' }, now)).toThrow()
      db.courses.dissolve(courseId, now)
      expect(db.portalWatches.list()).toMatchObject([{ courseId: other }])
    } finally {
      db.close()
    }
  })
})
