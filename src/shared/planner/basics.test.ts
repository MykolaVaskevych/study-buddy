import { beliefMean, levelAccuracy, observedAccuracy, updateBelief } from './belief'
import { budgetFromInput, resolveBudget } from './budget'
import { isoDayNumber, studyDaysUntil } from './dates'
import { approxPercent, formatMinutes, formatPercent } from './format'
import { planInput } from './test-utils'

describe('mastery belief', () => {
  it('updates a Beta belief, starting from Beta(1, 1)', () => {
    const b = updateBelief(null, 3, 1)
    expect(b).toEqual({ alpha: 4, beta: 2 })
    expect(updateBelief(b, 1, 2)).toEqual({ alpha: 5, beta: 4 })
    expect(updateBelief(b, -1, Number.NaN)).toEqual(b)
  })

  it('reports the posterior mean, null without a belief', () => {
    expect(beliefMean(null)).toBeNull()
    expect(beliefMean({ alpha: 3, beta: 1 })).toBe(0.75)
    expect(beliefMean({ alpha: 0, beta: 0 })).toBeNull()
    expect(observedAccuracy(updateBelief(null, 9, 1))).toBeCloseTo(0.9, 10)
    expect(observedAccuracy({ alpha: 1, beta: 1 })).toBeNull()
  })

  it('blends evidence into a level accuracy monotonically and never below the default', () => {
    let prev = levelAccuracy(0.25, null, 4)
    expect(prev).toBe(0.25)
    let b = null
    for (let i = 0; i < 20; i++) {
      b = updateBelief(b, 1, 0)
      const next = levelAccuracy(0.25, b, 4)
      expect(next).toBeGreaterThanOrEqual(prev)
      prev = next
    }
    expect(levelAccuracy(0.9, updateBelief(null, 0, 10), 4)).toBe(0.9)
    expect(levelAccuracy(0, updateBelief(null, 0, 1), 4)).toBe(0)
  })
})

describe('budget', () => {
  it('uses total hours first', () => {
    expect(budgetFromInput(planInput({ totalHours: 6 }), '2026-10-17')).toBe(360)
  })

  it('otherwise uses hours per day × days until the exam (exam day excluded, at least 1)', () => {
    const input = planInput({ hoursPerDay: 2, examDate: '2026-10-20' })
    expect(budgetFromInput(input, '2026-10-17')).toBe(360)
    expect(budgetFromInput({ ...input, examDate: '2026-10-18' }, '2026-10-17')).toBe(120)
    expect(budgetFromInput({ ...input, examDate: '2026-10-10' }, '2026-10-17')).toBe(120)
    expect(budgetFromInput({ ...input, examDate: '2026-10-20T09:00:00Z' }, '2026-10-17T23:00:00Z')).toBe(360)
  })

  it('caps total hours by what the calendar allows', () => {
    const info = resolveBudget(
      planInput({ totalHours: 20, hoursPerDay: 2, examDate: '2026-10-20' }),
      '2026-10-17'
    )
    expect(info).toMatchObject({ minutes: 360, source: 'capped', days: 3 })
  })

  it('falls back to the default and says why', () => {
    expect(resolveBudget(planInput(), '2026-10-17')).toMatchObject({ minutes: 600, problem: 'missing' })
    expect(resolveBudget(planInput({ hoursPerDay: 2 }), '2026-10-17').problem).toBe('no_exam_date')
    expect(resolveBudget(planInput({ hoursPerDay: 2, examDate: '2026-02-30' }), '2026-10-17').problem).toBe(
      'bad_exam_date'
    )
    expect(resolveBudget(planInput({ hoursPerDay: 2, examDate: '2026-10-20' }), undefined).problem).toBe(
      'no_today'
    )
  })

  it('counts calendar days across month and DST boundaries', () => {
    expect(studyDaysUntil('2026-10-24', '2026-11-02')).toBe(9)
    expect(studyDaysUntil('2026-12-31', '2027-01-01')).toBe(1)
    expect(isoDayNumber('not a date')).toBeNull()
  })
})

describe('format', () => {
  it('formats minutes', () => {
    expect(formatMinutes(135)).toBe('2 h 15 m')
    expect(formatMinutes(40)).toBe('40 m')
    expect(formatMinutes(180)).toBe('3 h')
    expect(formatMinutes(-5)).toBe('0 m')
  })

  it('formats shares', () => {
    expect(formatPercent(0.8)).toBe('80 %')
    expect(approxPercent(0.142)).toBe('~14 %')
    expect(approxPercent(0.001)).toBe('<1 %')
    expect(approxPercent(0)).toBe('~0 %')
  })
})
