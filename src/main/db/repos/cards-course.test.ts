import { newCard, openTestDb, seedDocument } from '../test-helpers'

describe('course card filters', () => {
  it('combines active cards across course files with global ordering, limits and next-due stats', () => {
    const { db } = openTestDb()
    try {
      const first = seedDocument(db, { sha256: 'first' })
      const second = seedDocument(db, { sha256: 'second' })
      const outside = seedDocument(db, { sha256: 'outside' })
      const now = '2026-10-17T10:00:00.000Z'
      const course = db.courses.create('Optics', [first, second], now)
      db.cards.insertMany([newCard(first, { front: 'later' })], now)
      db.cards.insertMany([newCard(second, { front: 'earlier' })], '2026-10-16T10:00:00.000Z')
      db.cards.insertMany([newCard(second, { front: 'future' })], '2026-10-20T10:00:00.000Z')
      db.cards.insertMany([newCard(outside)], '2026-10-15T10:00:00.000Z')
      const [inactive] = db.cards.insertMany([newCard(second)], now)
      if (!inactive) throw new Error('missing card')
      db.cards.update(inactive.id, { status: 'suspended' })

      expect(db.cards.due(null, now, 10, course.id).map((c) => c.front)).toEqual(['earlier', 'later'])
      expect(db.cards.due(null, now, 1, course.id).map((c) => c.front)).toEqual(['earlier'])
      expect(db.cards.stats(null, now, course.id)).toEqual({
        due: 2,
        new: 3,
        learning: 0,
        review: 0,
        total: 3,
        nextDue: '2026-10-20T10:00:00.000Z'
      })
      expect(db.cards.due(first, now, 10, course.id).map((c) => c.front)).toEqual(['later'])
      expect(db.cards.stats(first, now, course.id)).toMatchObject({ due: 1, total: 1, nextDue: null })
      expect(db.cards.due(outside, now, 10, course.id)).toEqual([])
      expect(db.cards.stats(outside, now, course.id).total).toBe(0)
      expect(db.cards.due(null, now, 10, 'missing')).toEqual([])
      expect(db.cards.stats(null, now, 'missing')).toEqual({
        due: 0,
        new: 0,
        learning: 0,
        review: 0,
        total: 0,
        nextDue: null
      })

      const target = db.courses.create('Other', [outside], now)
      db.courses.moveDocument(second, target.id, 1)
      expect(db.cards.due(null, now, 10, course.id).map((c) => c.docId)).toEqual([first])
      expect(db.cards.stats(null, now, course.id)).toMatchObject({ total: 1, nextDue: null })
      expect(db.cards.due(null, now, 10)).toHaveLength(3)
      expect(db.cards.stats(null, now).total).toBe(4)
    } finally {
      db.close()
    }
  })
})
