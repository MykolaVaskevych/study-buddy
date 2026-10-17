import { PLANNER_DEFAULTS } from '@shared/planner'
import type { PlanInput } from '@shared/planner'
import { addDays, daysBetween, formatDay, localDay, toLocalDay } from './dates'
import {
  changedTopicCount,
  defaultDraft,
  draftFromInput,
  sameInput,
  studyDays,
  toPlanInput,
  withBudgetMode,
  withPin,
  withWeight
} from './draft'

const today = '2026-10-17'

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  examDate: '2026-10-26',
  totalHours: null,
  hoursPerDay: 2,
  targetScore: 0.7,
  mode: 'max_score',
  format: 'mixed',
  overrides: [],
  ...over
})

describe('planner dates', () => {
  it('counts calendar days and formats them without time-zone drift', () => {
    expect(localDay(new Date(2026, 9, 17, 23, 59))).toBe('2026-10-17')
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02')
    expect(daysBetween('2026-10-17', '2026-10-26')).toBe(9)
    expect(daysBetween('2026-10-17', 'soon')).toBeNull()
    expect(toLocalDay('2026-10-26')).toBe('2026-10-26')
    expect(toLocalDay(new Date(2026, 9, 26, 12).toISOString())).toBe('2026-10-26')
    expect(toLocalDay('not a date')).toBeNull()
    expect(formatDay('2026-10-17')).toMatch(/17/)
  })
})

describe('planner draft', () => {
  it('starts from the book’s exam date, 2 h a day, a 70 % target, best score, mixed format', () => {
    const d = defaultDraft(today, '2026-10-26')
    expect(d).toMatchObject({
      examDate: '2026-10-26',
      budgetMode: 'daily',
      hoursPerDay: 2,
      targetScore: 0.7,
      mode: 'max_score',
      format: 'mixed',
      reserveFraction: PLANNER_DEFAULTS.reserveFraction
    })
    expect(d.totalHours).toBe(18)
  })

  it('uses an exam a week out when the book has none or it has passed', () => {
    expect(defaultDraft(today, null).examDate).toBe('2026-10-24')
    expect(defaultDraft(today, '2026-10-01').examDate).toBe('2026-10-24')
  })

  it('round-trips a saved input, so an untouched plan is never "edited"', () => {
    const saved = input({
      overrides: [
        { topicId: 'b', examWeight: 0.2 },
        { topicId: 'a', level: 'skip' },
        { topicId: 'b', level: 'core' }
      ],
      reserveFraction: 0.3
    })
    const draft = draftFromInput(saved, today)
    expect(draft.pins).toEqual({ a: 'skip', b: 'core' })
    expect(draft.weights).toEqual({ b: 0.2 })
    expect(sameInput(toPlanInput(draft), saved)).toBe(true)
    expect(toPlanInput(draft).overrides).toEqual([
      { topicId: 'a', level: 'skip' },
      { topicId: 'b', level: 'core', examWeight: 0.2 }
    ])
  })

  it('treats a missing reserve as the default and notices real differences', () => {
    const base = input()
    expect(sameInput(base, { ...base, reserveFraction: PLANNER_DEFAULTS.reserveFraction })).toBe(true)
    expect(sameInput(base, { ...base, targetScore: 0.71 })).toBe(false)
    expect(sameInput(base, { ...base, overrides: [{ topicId: 'a', level: 'full' }] })).toBe(false)
    expect(sameInput(base, { ...base, hoursPerDay: null, totalHours: 18 })).toBe(false)
  })

  it('sends only the active budget field', () => {
    const daily = toPlanInput(defaultDraft(today, '2026-10-26'))
    expect(daily).toMatchObject({ hoursPerDay: 2, totalHours: null })
    const total = toPlanInput(draftFromInput(input({ hoursPerDay: null, totalHours: 8 }), today))
    expect(total).toMatchObject({ hoursPerDay: null, totalHours: 8 })
  })

  it('keeps the budget when switching between per day and in total', () => {
    const d = defaultDraft(today, '2026-10-26')
    const total = withBudgetMode(d, 'total', today)
    expect(total).toMatchObject({ budgetMode: 'total', totalHours: 18 })
    const back = withBudgetMode({ ...total, totalHours: 13.5 }, 'daily', today)
    expect(back).toMatchObject({ budgetMode: 'daily', hoursPerDay: 1.5 })
    expect(studyDays(null, today)).toBeNull()
    expect(studyDays(today, today)).toBe(1)
  })

  it('pins and weights are set and cleared per topic', () => {
    let d = defaultDraft(today, null)
    d = withPin(d, 'a', 'skip')
    d = withWeight(d, 'b', 1.4)
    expect(d.pins).toEqual({ a: 'skip' })
    expect(d.weights).toEqual({ b: 1 })
    expect(changedTopicCount(withPin(d, 'b', 'core'))).toBe(2)
    d = withPin(withWeight(d, 'b', null), 'a', null)
    expect(changedTopicCount(d)).toBe(0)
  })
})
