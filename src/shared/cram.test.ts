import { cramMinutes, cramQuestionCount, cramQuestionTypes } from './cram'

describe('cram sizing', () => {
  it('asks exam-like question types', () => {
    expect(cramQuestionTypes({ formats: { mcq: 1, written: 0, numeric: 0 }, formulas: 'none' })).toEqual([
      'mcq',
      'multi',
      'tf'
    ])
    expect(cramQuestionTypes({ formats: { mcq: 0, written: 0.5, numeric: 0.5 }, formulas: 'none' })).toEqual([
      'short'
    ])
    expect(cramQuestionTypes({ formats: { mcq: 0, written: 0, numeric: 0 }, formulas: 'apply' })).toBeNull()
  })

  it('fits the standard size into about 30 minutes', () => {
    expect(cramQuestionCount(20)).toBe(10)
    expect(cramQuestionCount(5)).toBe(5)
    expect(cramQuestionCount(30)).toBe(15)
    expect(cramMinutes(20, 10)).toBe(30)
    expect(cramMinutes(10, 5)).toBe(15)
    expect(cramMinutes(0, 5)).toBe(10)
  })
})
