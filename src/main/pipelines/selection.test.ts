import type { AttemptResult, PageNotes, Question } from '@shared/domain'
import {
  defaultCardCount,
  distribute,
  isContinuation,
  isFresh,
  mockAllocation,
  pickFresh,
  reviewPages,
  rubricFromAnswer
} from './selection'

const NOW = new Date('2026-10-17T10:00:00.000Z')
const daysAgo = (d: number): string => new Date(NOW.getTime() - d * 86_400_000).toISOString()

function question(id: string, overrides: Partial<Question> = {}): Question {
  return {
    id,
    docId: 'd',
    topicId: null,
    type: 'mcq',
    stem: id,
    options: ['a', 'b'],
    answer: { type: 'mcq', correctIndex: 0 },
    explanation: '',
    optionRationales: null,
    difficulty: 2,
    sourcePages: [1],
    evidence: null,
    verification: 'verified',
    status: 'active',
    fromBook: false,
    createdAt: daysAgo(30),
    ...overrides
  }
}

function notes(page: number, overrides: Partial<PageNotes> = {}): PageNotes {
  return {
    docId: 'd',
    page,
    label: null,
    indexed: true,
    kind: 'content',
    teachable: true,
    summary: '',
    keyPoints: [],
    concepts: [],
    formulas: [],
    exercises: [],
    examSignals: [],
    ...overrides
  }
}

const LONG = 'x'.repeat(400)

describe('distribute', () => {
  it('splits proportionally with largest remainders and keeps the total', () => {
    expect(distribute(10, [1, 1, 1])).toEqual([4, 3, 3])
    expect(distribute(5, [3, 1])).toEqual([4, 1])
    expect(distribute(2, [1, 1, 1, 1])).toEqual([1, 1, 0, 0])
    expect(distribute(7, [0, 0])).toEqual([4, 3])
    expect(distribute(3, [])).toEqual([])
    expect(distribute(6, [Number.NaN, 2, -1])).toEqual([0, 6, 0])
  })
})

describe('defaultCardCount', () => {
  it('is 5 for a page, 15-25 for topic-sized windows, fewer for essentials', () => {
    expect(defaultCardCount(1, false)).toBe(5)
    expect(defaultCardCount(3, false)).toBe(11)
    expect(defaultCardCount(5, false)).toBe(15)
    expect(defaultCardCount(12, false)).toBe(22)
    expect(defaultCardCount(80, false)).toBe(25)
    expect(defaultCardCount(1, true)).toBe(3)
    expect(defaultCardCount(80, true)).toBe(15)
  })
})

describe('freshness', () => {
  it('never-answered first, then the longest-ago answered; recent and inactive ones are skipped', () => {
    const qs = [
      question('recent'),
      question('old'),
      question('new'),
      question('older'),
      question('reported', { status: 'reported' }),
      question('tf', { type: 'tf' })
    ]
    const answered = new Map([
      ['recent', daysAgo(2)],
      ['old', daysAgo(8)],
      ['older', daysAgo(20)]
    ])
    expect(pickFresh(qs, answered, NOW, { limit: 10 }).map((q) => q.id)).toEqual([
      'new',
      'tf',
      'older',
      'old'
    ])
    expect(pickFresh(qs, answered, NOW, { limit: 2, types: ['mcq'] }).map((q) => q.id)).toEqual([
      'new',
      'older'
    ])
    expect(pickFresh(qs, answered, NOW, { limit: 10, exclude: new Set(['new']) }).map((q) => q.id)).toEqual([
      'tf',
      'older',
      'old'
    ])
    expect(isFresh(undefined, NOW)).toBe(true)
    expect(isFresh(daysAgo(7), NOW)).toBe(false)
    expect(isFresh(daysAgo(7.01), NOW)).toBe(true)
  })
})

describe('mockAllocation', () => {
  it('weights by exam weight × (1 − mastery), unknown mastery counting as 0.5', () => {
    const alloc = mockAllocation(
      [
        { id: 'heavy-unknown', weight: 0.5, mastery: null },
        { id: 'light-weak', weight: 0.25, mastery: 0 },
        { id: 'mastered', weight: 0.25, mastery: 1 }
      ],
      10
    )
    expect(Object.fromEntries(alloc)).toEqual({ 'heavy-unknown': 5, 'light-weak': 5, mastered: 0 })
  })
})

describe('rubricFromAnswer', () => {
  it('splits book answers into lines, bullets or sentences (max 5)', () => {
    expect(rubricFromAnswer('0.2 dB/km x 50 km = 10 dB.')).toEqual(['0.2 dB/km x 50 km = 10 dB.'])
    expect(rubricFromAnswer('First point. Second point; Third.')).toEqual([
      'First point.',
      'Second point;',
      'Third.'
    ])
    expect(rubricFromAnswer('- a1\n- b2\n3) c3')).toEqual(['a1', 'b2', 'c3'])
    expect(rubricFromAnswer('A. B. C. D. E. F.')).toHaveLength(5)
    expect(rubricFromAnswer('  ')).toEqual([''])
  })
})

describe('reviewPages', () => {
  it('lists source pages of wrong answers, most cited first', () => {
    const qs = new Map([
      ['a', question('a', { sourcePages: [4, 5] })],
      ['b', question('b', { sourcePages: [5] })],
      ['c', question('c', { sourcePages: [2] })]
    ])
    const attempt = (questionId: string, correct: boolean): AttemptResult => ({
      questionId,
      correct,
      score: correct ? 1 : 0,
      feedback: null,
      missingPoints: [],
      correctAnswer: ''
    })
    expect(reviewPages([attempt('a', false), attempt('b', false), attempt('c', true)], qs)).toEqual([5, 4])
    expect(reviewPages([attempt('c', true)], qs)).toEqual([])
  })
})

describe('isContinuation', () => {
  const base = { prevText: `Fibre modes\n${LONG}`, curText: `Dispersion\n${LONG}`, sameTopic: true }

  it('detects repeated titles, (cont.) markers, thin pages and answers after exercises', () => {
    expect(isContinuation({ ...base, prev: notes(4), cur: notes(5) })).toBe(false)
    expect(isContinuation({ ...base, curText: `Fibre modes\n${LONG}`, prev: notes(4), cur: notes(5) })).toBe(
      true
    )
    expect(
      isContinuation({ ...base, curText: `Fibre modes (cont.)\n${LONG}`, prev: notes(4), cur: notes(5) })
    ).toBe(true)
    expect(
      isContinuation({ ...base, curText: `Dispersion (2/3)\n${LONG}`, prev: notes(4), cur: notes(5) })
    ).toBe(true)
    expect(isContinuation({ ...base, curText: '', prev: notes(4), cur: notes(5) })).toBe(true)
    expect(
      isContinuation({ ...base, prev: notes(4, { kind: 'exercise' }), cur: notes(5, { kind: 'answers' }) })
    ).toBe(true)
  })

  it('never across topics, after unteachable or unindexed pages, or after non-content pages', () => {
    const thin = { ...base, curText: '' }
    expect(isContinuation({ ...thin, sameTopic: false, prev: notes(4), cur: notes(5) })).toBe(false)
    expect(isContinuation({ ...thin, prev: notes(4, { teachable: false }), cur: notes(5) })).toBe(false)
    expect(isContinuation({ ...thin, prev: notes(4, { indexed: false }), cur: notes(5) })).toBe(false)
    expect(isContinuation({ ...thin, prev: notes(4, { kind: 'title' }), cur: notes(5) })).toBe(false)
    expect(isContinuation({ ...thin, prev: null, cur: notes(5) })).toBe(false)
  })
})
