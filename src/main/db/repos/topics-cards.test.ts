import { createSrs } from '@main/srs'
import type { NewTopic } from '../types'
import { newCard, newQuestion, openTestDb, seedDocument } from '../test-helpers'

const topic = (key: string, overrides: Partial<NewTopic> = {}): NewTopic => ({
  key,
  parentKey: null,
  title: key.toUpperCase(),
  pageStart: 1,
  pageEnd: 10,
  objectives: [`Understand ${key}`],
  estimates: null,
  ...overrides
})

const estimates = (prerequisites: string[]) => ({
  difficulty: 3,
  examWeight: 0.2,
  examWeightReasons: ['practice exam'],
  coreFraction: 0.6,
  coreMinutes: 30,
  fullMinutes: 60,
  prerequisites
})

describe('TopicRepo', () => {
  it('replaceAll resolves parent and prerequisite keys to ids, dropping unknown and self references', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const result = db.topics.replaceAll(doc, [
      topic('child', {
        parentKey: 'root',
        pageStart: 3,
        pageEnd: 5,
        estimates: estimates(['basics', 'nope', 'child'])
      }),
      topic('root', { pageStart: 1, pageEnd: 10 }),
      topic('basics', { pageStart: 1, pageEnd: 2, estimates: estimates([]) })
    ])
    const byKey = Object.fromEntries(result.map((t) => [t.title.toLowerCase(), t]))
    expect(result.map((t) => t.order)).toEqual([0, 1, 2])
    expect(byKey['child']?.parentId).toBe(byKey['root']?.id)
    expect(byKey['child']?.estimates?.prerequisites).toEqual([byKey['basics']?.id])
    expect(byKey['root']?.parentId).toBeNull()
    expect(db.topics.get(byKey['child']!.id)).toEqual(byKey['child'])
  })

  it('breaks parent cycles instead of storing a loop', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const result = db.topics.replaceAll(doc, [
      topic('a', { parentKey: 'b' }),
      topic('b', { parentKey: 'a' }),
      topic('self', { parentKey: 'self' })
    ])
    expect(result.every((t) => t.parentId === null)).toBe(true)
    expect(db.topics.forPage(doc, 4)).not.toBeNull()
  })

  it('forPage returns the deepest topic containing the page', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    db.topics.replaceAll(doc, [
      topic('book', { pageStart: 1, pageEnd: 20 }),
      topic('ch1', { parentKey: 'book', pageStart: 1, pageEnd: 10 }),
      topic('ch1.2', { parentKey: 'ch1', pageStart: 4, pageEnd: 6 }),
      topic('ch2', { parentKey: 'book', pageStart: 11, pageEnd: 20 })
    ])
    expect(db.topics.forPage(doc, 5)?.title).toBe('CH1.2')
    expect(db.topics.forPage(doc, 8)?.title).toBe('CH1')
    expect(db.topics.forPage(doc, 15)?.title).toBe('CH2')
    expect(db.topics.forPage(doc, 99)).toBeNull()
  })

  it('mastery starts from a Beta(1,1) prior and accumulates evidence', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [t] = db.topics.replaceAll(doc, [topic('a')])
    expect(db.topics.mastery(t!.id)).toBeNull()
    expect(t!.mastery).toBeNull()
    expect(db.topics.addMasteryEvidence(t!.id, 3, 1)).toEqual({ alpha: 4, beta: 2 })
    expect(db.topics.addMasteryEvidence(t!.id, 0.5, -2)).toEqual({ alpha: 4.5, beta: 2 })
    expect(db.topics.mastery(t!.id)).toEqual({ alpha: 4.5, beta: 2 })
    expect(db.topics.get(t!.id)?.mastery).toBeCloseTo(4.5 / 6.5, 10)
    expect(() => db.topics.addMasteryEvidence('missing', 1, 0)).toThrow(/not found/)
  })

  it('a rebuild carries mastery and items over to the same topic and re-links orphans by page', () => {
    const { db, clock } = openTestDb()
    const doc = seedDocument(db)
    const [a, b] = db.topics.replaceAll(doc, [
      topic('a', { pageStart: 1, pageEnd: 5 }),
      topic('b', { pageStart: 6, pageEnd: 10 })
    ])
    db.topics.addMasteryEvidence(a!.id, 2, 0)
    const now = clock.now().toISOString()
    const [cardA] = db.cards.insertMany([newCard(doc, { topicId: a!.id, sourcePages: [2] })], now)
    const [cardB] = db.cards.insertMany([newCard(doc, { topicId: b!.id, sourcePages: [8] })], now)
    const [q] = db.questions.insertMany([newQuestion(doc, { topicId: null, sourcePages: [9] })], now)

    const rebuilt = db.topics.replaceAll(doc, [
      topic('a2', { title: 'a', pageStart: 1, pageEnd: 5 }), // same title -> same topic
      topic('c', { pageStart: 6, pageEnd: 10 })
    ])
    const [a2, c] = rebuilt
    expect(db.topics.mastery(a2!.id)).toEqual({ alpha: 3, beta: 1 })
    expect(db.topics.mastery(c!.id)).toBeNull()
    expect(db.cards.get(cardA!.id)?.topicId).toBe(a2!.id)
    expect(db.cards.get(cardB!.id)?.topicId).toBe(c!.id)
    expect(db.questions.get(q!.id)?.topicId).toBe(c!.id)
    expect(db.topics.get(a!.id)).toBeNull()
    expect(db.topics.list(doc)).toEqual(rebuilt)
  })

  it('updateEstimates and minutesSpent (reading time on the topic pages)', () => {
    const { db, clock } = openTestDb()
    const doc = seedDocument(db)
    const [t] = db.topics.replaceAll(doc, [topic('a', { pageStart: 2, pageEnd: 3 })])
    db.topics.updateEstimates(t!.id, estimates([]))
    expect(db.topics.get(t!.id)?.estimates?.coreMinutes).toBe(30)
    const now = clock.now().toISOString()
    db.reading.track(doc, 1, 600, now)
    db.reading.track(doc, 2, 60, now)
    db.reading.track(doc, 3, 120, now)
    expect(db.topics.minutesSpent(t!.id)).toBe(3)
    expect(db.topics.minutesSpent('missing')).toBe(0)
  })
})

describe('CardRepo', () => {
  it('insertMany creates new-card SRS data identical to Srs.newCard', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const now = '2026-10-17T10:00:00.000Z'
    const [card] = db.cards.insertMany([newCard(doc, { sourcePages: [5, 3, 3, 0] })], now)
    expect(card).toMatchObject({ docId: doc, status: 'active', createdAt: now, sourcePages: [3, 5] })
    expect(card!.srs).toEqual(createSrs().newCard(now))
  })

  it('due() returns active due cards ordered by due date, within the limit and document', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db, { sha256: '1' })
    const other = seedDocument(db, { sha256: '2' })
    const mk = (docId: string, front: string, due: string) => {
      const [c] = db.cards.insertMany([newCard(docId, { front })], '2026-10-01T00:00:00.000Z')
      return db.cards.saveReview(
        c!.id,
        { ...c!.srs, due, state: 'review', reps: 1, lastReview: '2026-10-01T00:00:00.000Z' },
        { rating: 3, reviewedAt: '2026-10-01T00:00:00.000Z', elapsedMs: 500 }
      )
    }
    mk(doc, 'late', '2026-10-16T00:00:00.000Z')
    mk(doc, 'early', '2026-10-10T00:00:00.000Z')
    mk(doc, 'future', '2026-10-30T00:00:00.000Z')
    const suspended = mk(doc, 'suspended', '2026-10-05T00:00:00.000Z')
    db.cards.update(suspended.id, { status: 'suspended' })
    mk(other, 'other', '2026-10-11T00:00:00.000Z')

    const now = '2026-10-17T00:00:00.000Z'
    expect(db.cards.due(doc, now, 10).map((c) => c.front)).toEqual(['early', 'late'])
    expect(db.cards.due(null, now, 10).map((c) => c.front)).toEqual(['early', 'other', 'late'])
    expect(db.cards.due(null, now, 1).map((c) => c.front)).toEqual(['early'])
    // Non-canonical ISO input (offset) is normalised before comparing.
    expect(db.cards.due(doc, '2026-10-16T02:00:00.000+02:00', 10).map((c) => c.front)).toEqual([
      'early',
      'late'
    ])
    expect(db.cards.stats(doc, now)).toEqual({
      due: 2,
      new: 0,
      learning: 0,
      review: 3,
      total: 3,
      nextDue: '2026-10-30T00:00:00.000Z'
    })
    // Suspended cards and other documents never count; nothing upcoming gives null.
    expect(db.cards.stats(other, now).nextDue).toBeNull()
  })

  it('list() filters by page, range, topic (with subtopics and unassigned items) and document', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [ch, sec] = db.topics.replaceAll(doc, [
      topic('ch', { pageStart: 1, pageEnd: 10 }),
      topic('sec', { parentKey: 'ch', pageStart: 4, pageEnd: 6 }),
      topic('other', { pageStart: 11, pageEnd: 20 })
    ])
    const now = '2026-10-17T10:00:00.000Z'
    db.cards.insertMany(
      [
        newCard(doc, { front: 'p3', sourcePages: [3], topicId: ch!.id }),
        newCard(doc, { front: 'p5', sourcePages: [5], topicId: sec!.id }),
        newCard(doc, { front: 'p7-unassigned', sourcePages: [7] }),
        newCard(doc, { front: 'p15', sourcePages: [15, 16] })
      ],
      now
    )
    // replaceAll re-links orphans only at rebuild time; p7 and p15 were inserted after it.
    const fronts = (scope: Parameters<typeof db.cards.list>[0]) =>
      db.cards.list(scope, false).map((c) => c.front)
    expect(fronts({ kind: 'page', docId: doc, page: 5 })).toEqual(['p5'])
    expect(fronts({ kind: 'range', docId: doc, from: 7, to: 3 })).toEqual(['p3', 'p5', 'p7-unassigned'])
    expect(fronts({ kind: 'topic', docId: doc, topicId: ch!.id })).toEqual(['p3', 'p5', 'p7-unassigned'])
    expect(fronts({ kind: 'topic', docId: doc, topicId: sec!.id })).toEqual(['p5'])
    expect(fronts({ kind: 'topic', docId: doc, topicId: 'missing' })).toEqual([])
    expect(fronts({ kind: 'document', docId: doc })).toHaveLength(4)
  })

  it('update edits text/status; inactive cards are hidden unless asked for; fronts include all', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [c] = db.cards.insertMany([newCard(doc)], '2026-10-17T10:00:00.000Z')
    const edited = db.cards.update(c!.id, { front: 'New front', status: 'reported' })
    expect(edited).toMatchObject({
      front: 'New front',
      back: 'Attenuation and dispersion',
      status: 'reported'
    })
    expect(db.cards.list({ kind: 'document', docId: doc }, false)).toEqual([])
    expect(db.cards.list({ kind: 'document', docId: doc }, true)).toHaveLength(1)
    expect(db.cards.fronts(doc)).toEqual(['New front'])
    expect(() => db.cards.update('missing', { front: 'x' })).toThrow(/not found/)
  })

  it('saveReview stores the new SRS state', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const srs = createSrs()
    const [c] = db.cards.insertMany([newCard(doc)], '2026-10-17T10:00:00.000Z')
    const next = srs.review(c!.srs, 3, '2026-10-17T10:05:00.000Z', null)
    const saved = db.cards.saveReview(c!.id, next, {
      rating: 3,
      reviewedAt: '2026-10-17T10:05:00.000Z',
      elapsedMs: 4200
    })
    expect(saved.srs).toEqual(next)
    expect(db.cards.stats(doc, '2026-10-17T10:05:00.000Z')).toMatchObject({ new: 0, learning: 1, total: 1 })
  })
})
