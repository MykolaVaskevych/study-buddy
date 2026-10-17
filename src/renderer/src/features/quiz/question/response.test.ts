import type { Question } from '@shared/domain'
import {
  describeResponse,
  emptyDraft,
  isChosen,
  optionMark,
  parseDecimal,
  pickChoice,
  splitValueUnit,
  toResponse
} from './response'

const question = (over: Partial<Question>): Question => ({
  id: 'q1',
  docId: 'd',
  topicId: null,
  type: 'mcq',
  stem: 'Stem',
  options: ['a', 'b', 'c', 'd'],
  answer: { type: 'mcq', correctIndex: 1 },
  explanation: '',
  optionRationales: null,
  difficulty: 2,
  sourcePages: [4],
  evidence: null,
  verification: 'verified',
  status: 'active',
  fromBook: false,
  createdAt: '2026-10-17T10:00:00Z',
  ...over
})

describe('parseDecimal', () => {
  it.each([
    ['-16', -16],
    ['−16', -16],
    ['1,5', 1.5],
    ['1,000.5', 1000.5],
    ['2.5e9', 2.5e9],
    ['2.5 × 10^9', 2.5e9],
    ['1 000', 1000],
    ['.5', 0.5]
  ])('%s → %d', (raw, n) => expect(parseDecimal(raw)).toBe(n))

  it.each(['', '-', 'abc', '1.2.3', '16 dBm'])('rejects %j', (raw) => expect(parseDecimal(raw)).toBeNull())
})

describe('splitValueUnit', () => {
  it('moves a typed unit out of the value', () => {
    expect(splitValueUnit('−16 dBm')).toEqual({ value: '−16', unit: 'dBm' })
    expect(splitValueUnit('2.5e9 Hz')).toEqual({ value: '2.5e9', unit: 'Hz' })
    expect(splitValueUnit('102ps')).toEqual({ value: '102', unit: 'ps' })
    expect(splitValueUnit('42')).toEqual({ value: '42', unit: '' })
  })
})

describe('drafts', () => {
  it('selects, toggles and maps tf choices', () => {
    expect(pickChoice(emptyDraft('mcq'), 2)).toEqual({ type: 'mcq', index: 2 })
    const multi = pickChoice(pickChoice(emptyDraft('multi'), 3), 0)
    expect(multi).toEqual({ type: 'multi', indices: [0, 3] })
    expect(pickChoice(multi, 3)).toEqual({ type: 'multi', indices: [0] })
    expect(pickChoice(emptyDraft('tf'), 1)).toEqual({ type: 'tf', value: false })
    expect(isChosen({ type: 'tf', value: false }, 1)).toBe(true)
    expect(pickChoice(emptyDraft('short'), 1)).toEqual(emptyDraft('short'))
  })

  it('builds responses only when complete', () => {
    expect(toResponse(emptyDraft('mcq'))).toBeNull()
    expect(toResponse(emptyDraft('multi'))).toBeNull()
    expect(toResponse({ type: 'short', text: '   ' })).toBeNull()
    expect(toResponse({ type: 'numeric', value: 'abc', unit: '' })).toBeNull()
    expect(toResponse({ type: 'numeric', value: '-16', unit: ' dBm ' })).toEqual({
      type: 'numeric',
      value: -16,
      unit: 'dBm'
    })
    expect(toResponse({ type: 'numeric', value: '−16 dBm', unit: '' })).toEqual({
      type: 'numeric',
      value: -16,
      unit: 'dBm'
    })
    expect(toResponse({ type: 'numeric', value: '0.24', unit: '' })).toEqual({
      type: 'numeric',
      value: 0.24,
      unit: null
    })
  })
})

describe('optionMark', () => {
  it('marks right, wrong and missed options', () => {
    const q = question({})
    const draft = { type: 'mcq' as const, index: 0 }
    expect([0, 1, 2].map((i) => optionMark(q, draft, i))).toEqual(['wrong', 'missed', null])
    const m = question({ type: 'multi', answer: { type: 'multi', correctIndices: [0, 2] } })
    expect([0, 1, 2, 3].map((i) => optionMark(m, { type: 'multi', indices: [0, 1] }, i))).toEqual([
      'right',
      'wrong',
      'missed',
      null
    ])
  })
})

describe('describeResponse', () => {
  it('summarises answers', () => {
    const q = question({})
    expect(describeResponse(q, { type: 'mcq', index: 1 })).toBe('B: b')
    expect(describeResponse(q, { type: 'numeric', value: -16, unit: 'dBm' })).toBe('-16 dBm')
    expect(describeResponse(q, null)).toBe('No answer')
  })
})
