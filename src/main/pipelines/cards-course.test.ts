import { newCard, seedDocument } from '../db/test-helpers'
import { createHarness } from './test-harness'

describe('course review channels', () => {
  it('scopes due cards and stats to all course files and updates them after a review', async () => {
    const harness = await createHarness()
    try {
      const { db, h, clock } = harness
      const first = seedDocument(db, { sha256: 'first' })
      const second = seedDocument(db, { sha256: 'second' })
      const outside = seedDocument(db, { sha256: 'outside' })
      const course = await h['courses.create']({ name: 'Optics', docIds: [first, second] })
      db.cards.insertMany([newCard(first), newCard(second), newCard(outside)], clock.now().toISOString())

      const due = await h['cards.due']({ docId: null, courseId: course.id, limit: 100 })
      expect(due.map((c) => c.docId)).toEqual([first, second])
      expect(await h['cards.stats']({ docId: null, courseId: course.id })).toMatchObject({
        total: 2,
        due: 2,
        nextDue: null
      })
      const card = due[1]
      if (!card) throw new Error('missing second-file card')
      await h['cards.review']({ cardId: card.id, rating: 4, elapsedMs: 1000 })
      expect(await h['cards.due']({ docId: null, courseId: course.id, limit: 100 })).toEqual([due[0]])
      expect(await h['cards.stats']({ docId: null, courseId: course.id })).toMatchObject({
        total: 2,
        due: 1,
        nextDue: db.cards.get(card.id)?.srs.due
      })
      expect(await h['cards.due']({ docId: outside, courseId: course.id, limit: 100 })).toEqual([])
      expect(await h['cards.stats']({ docId: outside, courseId: course.id })).toMatchObject({ total: 0 })
      expect(await h['cards.due']({ docId: null, courseId: 'missing', limit: 100 })).toEqual([])
      expect(await h['cards.stats']({ docId: null, courseId: 'missing' })).toMatchObject({ total: 0 })
      expect(await h['cards.due']({ docId: outside, limit: 100 })).toHaveLength(1)
      expect(await h['cards.stats']({ docId: null })).toMatchObject({ total: 3, due: 2 })
    } finally {
      await harness.close()
    }
  })
})
