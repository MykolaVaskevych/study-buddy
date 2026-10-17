import type { PlanInput } from './types'
import { isoDayNumber, studyDaysUntil } from './dates'
import { PLANNER_DEFAULTS, type PlannerParams } from './model'

/** How the study budget was derived. The solver turns this into a note. */
export interface BudgetInfo {
  /** Total study minutes, before the review reserve is taken out. */
  minutes: number
  /**
   * total    totalHours × 60
   * daily    hoursPerDay × days until the exam
   * capped   totalHours, cut down to hoursPerDay × days because that is all the calendar allows
   * default  nothing usable was given, PLANNER_DEFAULTS.defaultBudgetHours
   */
  source: 'total' | 'daily' | 'capped' | 'default'
  /** Study days until the exam (exam day excluded), when both dates are known. */
  days: number | null
  /** Why the default was used, or null. */
  problem: 'missing' | 'no_exam_date' | 'no_today' | 'bad_exam_date' | null
}

const positive = (x: number | null): number | null => (x !== null && Number.isFinite(x) && x > 0 ? x : null)

/**
 * Derives the study budget. The order is totalHours, then hoursPerDay × days until the exam, then a default.
 * When total hours and a daily limit with an exam date are all given, the smaller one wins, because
 * the schedule cannot fit more than hoursPerDay into each day.
 */
export function resolveBudget(
  input: PlanInput,
  today: string | null | undefined,
  params: PlannerParams = PLANNER_DEFAULTS
): BudgetInfo {
  const total = positive(input.totalHours)
  const perDay = positive(input.hoursPerDay)
  const examValid = input.examDate !== null && isoDayNumber(input.examDate) !== null
  const days = examValid && input.examDate !== null && today ? studyDaysUntil(today, input.examDate) : null
  const daily = perDay !== null && days !== null ? Math.round(perDay * 60 * days) : null

  if (total !== null) {
    const minutes = Math.round(total * 60)
    if (daily !== null && daily < minutes) return { minutes: daily, source: 'capped', days, problem: null }
    return { minutes, source: 'total', days, problem: null }
  }
  if (daily !== null) return { minutes: daily, source: 'daily', days, problem: null }

  let problem: BudgetInfo['problem'] = 'missing'
  if (perDay !== null) {
    if (input.examDate === null) problem = 'no_exam_date'
    else if (!examValid) problem = 'bad_exam_date'
    else problem = 'no_today'
  }
  return { minutes: Math.round(params.defaultBudgetHours * 60), source: 'default', days, problem }
}

/** Total study minutes available (before the review reserve). `today` is an ISO date. */
export function budgetFromInput(input: PlanInput, today: string): number {
  return resolveBudget(input, today).minutes
}
