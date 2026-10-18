import type { NewTopic } from '../types'
import { newCard, newQuestion, openTestDb, seedDocument } from '../test-helpers'

const NOW = '2026-10-17T10:00:00.000Z'
const topic = (key: string, pageStart: number, pageEnd: number): NewTopic => ({
  key,
  parentKey: null,
  title: key,
  pageStart,
  pageEnd,
  objectives: [],
  estimates: null
})

describe('annotations', () => {
  it('keeps one bookmark and one note per page, upserts and removes', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db, {}, 10)
    db.annotations.upsert({ docId: doc, page: 3, kind: 'bookmark', text: '' }, NOW)
    db.annotations.upsert({ docId: doc, page: 3, kind: 'note', text: 'check units' }, NOW)
    const updated = db.annotations.upsert(
      { docId: doc, page: 3, kind: 'note', text: 'dBm vs dB' },
      '2026-10-17T11:00:00.000Z'
    )
    expect(updated.text).toBe('dBm vs dB')
    expect(db.annotations.list(doc).map((a) => [a.page, a.kind, a.text])).toEqual([
      [3, 'bookmark', ''],
      [3, 'note', 'dBm vs dB']
    ])
    db.annotations.remove(doc, 3, 'bookmark')
    expect(db.annotations.list(doc)).toHaveLength(1)
  })
})

describe('progress', () => {
  function seeded() {
    const { db } = openTestDb()
    const doc = seedDocument(db, {}, 20)
    const [a, b] = db.topics.replaceAll(doc, [topic('a', 1, 10), topic('b', 11, 20)])
    const [cardA, cardB] = db.cards.insertMany(
      [newCard(doc, { topicId: a!.id }), newCard(doc, { topicId: b!.id })],
      NOW
    )
    const reviewed = { ...cardA!.srs, reps: 3, state: 'review' as const, lastReview: NOW }
    db.cards.saveReview(cardA!.id, reviewed, { rating: 3, reviewedAt: NOW, elapsedMs: 1000 })
    db.cards.saveReview(
      cardB!.id,
      { ...cardB!.srs, reps: 1, state: 'learning' },
      { rating: 3, reviewedAt: NOW, elapsedMs: 1000 }
    )
    const [qa] = db.questions.insertMany([newQuestion(doc, { topicId: a!.id })], NOW)
    const quiz = db.quizzes.create(
      {
        docId: doc,
        mode: 'topic',
        scope: { kind: 'document', docId: doc },
        questionIds: [qa!.id],
        timeLimit: null
      },
      NOW
    )
    db.quizzes.saveAttempt(
      quiz,
      { questionId: qa!.id, correct: true, score: 1, feedback: null, missingPoints: [], correctAnswer: 'x' },
      { type: 'tf', value: true },
      1000,
      NOW
    )
    db.topics.addMasteryEvidence(a!.id, 3, 1)
    db.topics.addMasteryEvidence(b!.id, 1, 1)
    db.reading.track(doc, 2, 60, NOW)
    db.reading.track(doc, 15, 60, NOW)
    return { db, doc, a: a!, b: b!, cardA: cardA!, cardB: cardB! }
  }

  it('counts reading, reviews and quizzes', () => {
    const { db, doc } = seeded()
    expect(db.progress.stats(doc)).toMatchObject({
      pagesRead: 2,
      secondsRead: 120,
      reviews: 2,
      quizzesFinished: 0
    })
  })

  it('resets one topic and leaves the rest alone', () => {
    const { db, doc, a, b, cardA, cardB } = seeded()
    const result = db.progress.reset(doc, { topicIds: [a.id], ranges: [{ from: 1, to: 10 }] }, NOW)
    expect(result).toEqual({ cards: 1, attempts: 1, readingPages: 1 })
    expect(db.cards.get(cardA.id)?.srs).toMatchObject({ state: 'new', reps: 0, lastReview: null })
    expect(db.cards.get(cardB.id)?.srs.reps).toBe(1)
    expect(db.topics.mastery(a.id)).toBeNull()
    expect(db.topics.mastery(b.id)).not.toBeNull()
    expect(db.progress.stats(doc)).toMatchObject({ pagesRead: 1, reviews: 1 })
  })

  it('resets the whole book but keeps the AI-made cards and questions', () => {
    const { db, doc } = seeded()
    db.progress.reset(doc, null, NOW)
    expect(db.progress.stats(doc)).toMatchObject({ pagesRead: 0, reviews: 0, quizzesFinished: 0 })
    expect(db.cards.list({ kind: 'document', docId: doc }, true)).toHaveLength(2)
    expect(db.cards.list({ kind: 'document', docId: doc }, true).every((c) => c.srs.state === 'new')).toBe(
      true
    )
    expect(
      db.questions.list({ kind: 'document', docId: doc }, { purpose: 'any', includeInactive: true })
    ).toHaveLength(1)
  })
})
