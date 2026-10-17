import type { AttemptResult, QuizResult } from '@shared/domain'
import { newQuestion, openTestDb, seedDocument } from '../test-helpers'

const attempt = (questionId: string, correct: boolean): AttemptResult => ({
  questionId,
  correct,
  score: correct ? 1 : 0,
  feedback: null,
  missingPoints: [],
  correctAnswer: '**C**'
})

describe('QuestionRepo', () => {
  it('stores questions with their purpose; page_check lists only page-check questions citing the page', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const now = '2026-10-17T10:00:00.000Z'
    const [check] = db.questions.insertMany(
      [newQuestion(doc, { stem: 'check p3', sourcePages: [3] })],
      now,
      'page_check'
    )
    db.questions.insertMany([newQuestion(doc, { stem: 'check p4', sourcePages: [4] })], now, 'page_check')
    db.questions.insertMany([newQuestion(doc, { stem: 'quiz p3', sourcePages: [3] })], now)
    expect(check).toMatchObject({ stem: 'check p3', status: 'active', createdAt: now, fromBook: false })
    expect(db.questions.get(check!.id)).toEqual(check)

    const page3 = { kind: 'page', docId: doc, page: 3 } as const
    const list = (purpose: 'page_check' | 'any') =>
      db.questions.list(page3, { purpose, includeInactive: false }).map((q) => q.stem)
    expect(list('page_check')).toEqual(['check p3'])
    expect(list('any')).toEqual(['check p3', 'quiz p3'])

    db.questions.setStatus(check!.id, 'reported', 'wrong key')
    expect(list('page_check')).toEqual([])
    expect(db.questions.list(page3, { purpose: 'page_check', includeInactive: true })).toHaveLength(1)
    expect(db.questions.stems(doc)).toEqual(['check p3', 'check p4', 'quiz p3'])
    expect(() => db.questions.setStatus('missing', 'active')).toThrow(/not found/)
  })

  it('keeps answer JSON typed', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [q] = db.questions.insertMany(
      [
        newQuestion(doc, {
          type: 'numeric',
          options: null,
          answer: { type: 'numeric', value: 0.2, tolerance: 0.05, unit: 'dB/km' }
        })
      ],
      '2026-10-17T10:00:00.000Z'
    )
    expect(db.questions.get(q!.id)?.answer).toEqual({
      type: 'numeric',
      value: 0.2,
      tolerance: 0.05,
      unit: 'dB/km'
    })
  })

  it('mistakes() are questions whose latest attempt is wrong, most recent first', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [q1, q2, q3, q4] = db.questions.insertMany(
      ['q1', 'q2', 'q3', 'q4'].map((stem) => newQuestion(doc, { stem })),
      '2026-10-17T10:00:00.000Z'
    )
    const scope = { kind: 'document', docId: doc } as const
    const quizA = db.quizzes.create(
      { docId: doc, mode: 'topic', scope, questionIds: [q1!.id, q2!.id, q3!.id], timeLimit: null },
      '2026-10-17T10:00:00.000Z'
    )
    db.quizzes.saveAttempt(
      quizA,
      attempt(q1!.id, false),
      { type: 'mcq', index: 0 },
      1000,
      '2026-10-17T10:01:00.000Z'
    )
    db.quizzes.saveAttempt(
      quizA,
      attempt(q2!.id, false),
      { type: 'mcq', index: 0 },
      1000,
      '2026-10-17T10:02:00.000Z'
    )
    db.quizzes.saveAttempt(
      quizA,
      attempt(q3!.id, true),
      { type: 'mcq', index: 2 },
      1000,
      '2026-10-17T10:03:00.000Z'
    )
    const quizB = db.quizzes.create(
      { docId: doc, mode: 'review_mistakes', scope, questionIds: [q1!.id, q3!.id], timeLimit: null },
      '2026-10-17T11:00:00.000Z'
    )
    db.quizzes.saveAttempt(
      quizB,
      attempt(q1!.id, true),
      { type: 'mcq', index: 2 },
      1000,
      '2026-10-17T11:01:00.000Z'
    )
    db.quizzes.saveAttempt(
      quizB,
      attempt(q3!.id, false),
      { type: 'mcq', index: 1 },
      1000,
      '2026-10-17T11:02:00.000Z'
    )

    expect(db.questions.mistakes(doc, 10)).toEqual([q3!.id, q2!.id])
    expect(db.questions.mistakes(doc, 1)).toEqual([q3!.id])
    db.questions.setStatus(q3!.id, 'suspended')
    expect(db.questions.mistakes(doc, 10)).toEqual([q2!.id])
    expect(q4).toBeTruthy()
  })
})

describe('QuizRepo', () => {
  it('creates, records attempts (re-answer replaces), finishes and lists history latest first', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [q1, q2] = db.questions.insertMany(
      [newQuestion(doc, { stem: 'a' }), newQuestion(doc, { stem: 'b' })],
      '2026-10-17T10:00:00.000Z'
    )
    const scope = { kind: 'range', docId: doc, from: 1, to: 5 } as const
    const quiz = db.quizzes.create(
      { docId: doc, mode: 'mock', scope, questionIds: [q2!.id, q1!.id], timeLimit: 30 },
      '2026-10-17T10:00:00.000Z'
    )
    expect(db.quizzes.get(quiz)).toEqual({
      id: quiz,
      docId: doc,
      mode: 'mock',
      scope,
      questionIds: [q2!.id, q1!.id],
      timeLimit: 30,
      createdAt: '2026-10-17T10:00:00.000Z',
      finishedAt: null
    })
    db.quizzes.saveAttempt(
      quiz,
      attempt(q2!.id, false),
      { type: 'mcq', index: 0 },
      900,
      '2026-10-17T10:01:00.000Z'
    )
    db.quizzes.saveAttempt(
      quiz,
      attempt(q1!.id, true),
      { type: 'mcq', index: 2 },
      900,
      '2026-10-17T10:02:00.000Z'
    )
    db.quizzes.saveAttempt(
      quiz,
      attempt(q2!.id, true),
      { type: 'mcq', index: 2 },
      900,
      '2026-10-17T10:03:00.000Z'
    )
    expect(db.quizzes.attempts(quiz).map((a) => [a.questionId, a.correct])).toEqual([
      [q1!.id, true],
      [q2!.id, true]
    ])

    const result = (quizId: string, finishedAt: string): QuizResult => ({
      quizId,
      score: 2,
      maxScore: 2,
      attempts: db.quizzes.attempts(quizId),
      perTopic: [{ topicId: null, score: 2, maxScore: 2 }],
      reviewPages: [],
      finishedAt
    })
    db.quizzes.finish(quiz, result(quiz, '2026-10-17T10:05:00.000Z'))
    const later = db.quizzes.create(
      { docId: doc, mode: 'topic', scope, questionIds: [q1!.id], timeLimit: null },
      '2026-10-18T10:00:00.000Z'
    )
    db.quizzes.create(
      { docId: doc, mode: 'topic', scope, questionIds: [], timeLimit: null },
      '2026-10-18T11:00:00.000Z'
    )
    db.quizzes.finish(later, result(later, '2026-10-18T10:05:00.000Z'))

    expect(db.quizzes.get(quiz)?.finishedAt).toBe('2026-10-17T10:05:00.000Z')
    expect(db.quizzes.history(doc, 10).map((r) => r.quizId)).toEqual([later, quiz])
    expect(db.quizzes.history(doc, 1).map((r) => r.quizId)).toEqual([later])
    expect(db.quizzes.get('missing')).toBeNull()
    expect(() => db.quizzes.finish('missing', result('missing', '2026-10-18T10:05:00.000Z'))).toThrow(
      /not found/
    )
  })
  it('lastAttemptAt() gives the latest answer time per question across quizzes', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const [q1, q2, q3] = db.questions.insertMany(
      [newQuestion(doc, { stem: 'a' }), newQuestion(doc, { stem: 'b' }), newQuestion(doc, { stem: 'c' })],
      '2026-10-17T10:00:00.000Z'
    )
    const scope = { kind: 'document', docId: doc } as const
    const quizA = db.quizzes.create(
      { docId: doc, mode: 'topic', scope, questionIds: [q1!.id, q2!.id], timeLimit: null },
      '2026-10-17T10:00:00.000Z'
    )
    const quizB = db.quizzes.create(
      { docId: doc, mode: 'topic', scope, questionIds: [q1!.id], timeLimit: null },
      '2026-10-18T10:00:00.000Z'
    )
    db.quizzes.saveAttempt(quizA, attempt(q1!.id, false), null, 1, '2026-10-17T10:01:00.000Z')
    db.quizzes.saveAttempt(quizA, attempt(q2!.id, true), null, 1, '2026-10-17T10:02:00.000Z')
    db.quizzes.saveAttempt(quizB, attempt(q1!.id, true), null, 1, '2026-10-18T10:01:00.000Z')

    expect(db.quizzes.lastAttemptAt([q1!.id, q2!.id, q3!.id, q1!.id])).toEqual(
      new Map([
        [q1!.id, '2026-10-18T10:01:00.000Z'],
        [q2!.id, '2026-10-17T10:02:00.000Z']
      ])
    )
    expect(db.quizzes.lastAttemptAt([])).toEqual(new Map())
  })
})
