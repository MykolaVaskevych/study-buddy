import { PLANNER_DEFAULTS } from '@shared/planner'
import type { ExamFormat, PlanInput, PlanMode, StudyLevel, TopicOverride } from '@shared/planner'
import { addDays, daysBetween } from './dates'

/**
 * The planner form as the student edits it. It is richer than PlanInput: it remembers both the
 * daily and the total hours so switching between them never loses a value, and it keeps pins and
 * weight overrides keyed by topic. `toPlanInput` turns it into what the solver and `plan.save` take.
 */

export type BudgetMode = 'daily' | 'total'

export interface PlannerDraft {
  /** YYYY-MM-DD, or null when the student has no date yet. */
  examDate: string | null
  budgetMode: BudgetMode
  hoursPerDay: number
  totalHours: number
  /** 0..1 */
  targetScore: number
  mode: PlanMode
  format: ExamFormat
  /** Share of the budget kept for checks, review and mocks, 0..1. */
  reserveFraction: number
  pace: number
  /** Levels the student pinned, by topic id. */
  pins: Readonly<Record<string, StudyLevel>>
  /** Exam weights the student entered, by topic id, 0..1. */
  weights: Readonly<Record<string, number>>
}

/** Ranges of the form controls. Hours move in 15-minute steps, like the solver's slots. */
export const LIMITS = {
  hoursPerDay: { min: 0.25, max: 10, step: 0.25 },
  totalHours: { min: 1, max: 120, step: 0.25 },
  target: { min: 0.5, max: 0.95 },
  reserve: { min: 0.1, max: 0.4, step: 0.05 },
  pace: { min: 0.5, max: 2, step: 0.25 }
} as const

/** Starting point when a book has no saved plan yet. */
export const DEFAULTS = {
  examInDays: 7,
  hoursPerDay: 2,
  targetScore: 0.7,
  mode: 'max_score',
  format: 'mixed'
} as const

const QUARTER = 0.25
const roundQuarter = (h: number): number => Math.round(h / QUARTER) * QUARTER
const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x))

/** Study days the budget counts (exam day excluded, at least 1), or null without a valid date. */
export function studyDays(examDate: string | null, today: string): number | null {
  if (!examDate) return null
  const d = daysBetween(today, examDate)
  return d === null ? null : Math.max(1, d)
}

/**
 * A fresh draft: the book's exam date if it is still ahead (else a week from today), 2 h a day,
 * a 70 % target, best score in the time, mixed format, the solver's default reserve.
 */
export function defaultDraft(today: string, examDate: string | null): PlannerDraft {
  const ahead = examDate !== null && (daysBetween(today, examDate) ?? 0) > 0
  const date = ahead && examDate ? examDate : addDays(today, DEFAULTS.examInDays)
  const days = studyDays(date, today) ?? DEFAULTS.examInDays
  return {
    examDate: date,
    budgetMode: 'daily',
    hoursPerDay: DEFAULTS.hoursPerDay,
    totalHours: DEFAULTS.hoursPerDay * days,
    targetScore: DEFAULTS.targetScore,
    mode: DEFAULTS.mode,
    format: DEFAULTS.format,
    reserveFraction: PLANNER_DEFAULTS.reserveFraction,
    pace: 1,
    pins: {},
    weights: {}
  }
}

/** The draft a saved input stands for. Overrides for the same topic merge, later entries winning. */
export function draftFromInput(input: PlanInput, today: string): PlannerDraft {
  const days = studyDays(input.examDate, today)
  const total = input.totalHours !== null && input.totalHours > 0 ? input.totalHours : null
  const perDay = input.hoursPerDay !== null && input.hoursPerDay > 0 ? input.hoursPerDay : null
  const hoursPerDay =
    perDay ??
    (total !== null && days !== null
      ? clamp(roundQuarter(total / days), LIMITS.hoursPerDay.min, LIMITS.hoursPerDay.max)
      : DEFAULTS.hoursPerDay)
  const pins: Record<string, StudyLevel> = {}
  const weights: Record<string, number> = {}
  for (const o of input.overrides) {
    if (o.level !== undefined) pins[o.topicId] = o.level
    if (o.examWeight !== undefined) weights[o.topicId] = o.examWeight
  }
  return {
    examDate: input.examDate,
    budgetMode: total !== null ? 'total' : 'daily',
    hoursPerDay,
    totalHours: total ?? hoursPerDay * (days ?? DEFAULTS.examInDays),
    targetScore: input.targetScore,
    mode: input.mode,
    format: input.format,
    reserveFraction: input.reserveFraction ?? PLANNER_DEFAULTS.reserveFraction,
    pace: input.pace ?? 1,
    pins,
    weights
  }
}

/** The solver input for a draft. Overrides are sorted by topic id so equal drafts give equal inputs. */
export function toPlanInput(draft: PlannerDraft): PlanInput {
  const ids = [...new Set([...Object.keys(draft.pins), ...Object.keys(draft.weights)])].sort()
  const overrides = ids.map((topicId): TopicOverride => {
    const level = draft.pins[topicId]
    const examWeight = draft.weights[topicId]
    return {
      topicId,
      ...(level !== undefined ? { level } : {}),
      ...(examWeight !== undefined ? { examWeight } : {})
    }
  })
  return {
    examDate: draft.examDate,
    totalHours: draft.budgetMode === 'total' ? draft.totalHours : null,
    hoursPerDay: draft.budgetMode === 'daily' ? draft.hoursPerDay : null,
    targetScore: draft.targetScore,
    mode: draft.mode,
    format: draft.format,
    overrides,
    reserveFraction: Math.round(draft.reserveFraction * 100) / 100,
    ...(draft.pace !== 1 ? { pace: Math.round(draft.pace * 100) / 100 } : {})
  }
}

const near = (a: number | null, b: number | null): boolean =>
  a === null || b === null ? a === b : Math.abs(a - b) < 1e-6

function canonicalOverrides(input: PlanInput): string {
  const merged = new Map<string, { level: StudyLevel | null; weight: number | null }>()
  for (const o of input.overrides) {
    const cur = merged.get(o.topicId) ?? { level: null, weight: null }
    merged.set(o.topicId, { level: o.level ?? cur.level, weight: o.examWeight ?? cur.weight })
  }
  return JSON.stringify([...merged.entries()].sort(([a], [b]) => a.localeCompare(b)))
}

/** True when two inputs ask the solver the same question (defaults filled in, overrides merged). */
export function sameInput(a: PlanInput, b: PlanInput): boolean {
  const reserve = (x: PlanInput): number => x.reserveFraction ?? PLANNER_DEFAULTS.reserveFraction
  return (
    a.examDate === b.examDate &&
    near(a.totalHours, b.totalHours) &&
    near(a.hoursPerDay, b.hoursPerDay) &&
    near(a.targetScore, b.targetScore) &&
    a.mode === b.mode &&
    a.format === b.format &&
    near(reserve(a), reserve(b)) &&
    near(a.pace ?? 1, b.pace ?? 1) &&
    canonicalOverrides(a) === canonicalOverrides(b)
  )
}

/**
 * Switches between "per day" and "in total" without changing the budget: the new field starts at
 * what the old one amounted to.
 */
export function withBudgetMode(draft: PlannerDraft, budgetMode: BudgetMode, today: string): PlannerDraft {
  if (budgetMode === draft.budgetMode) return draft
  const days = studyDays(draft.examDate, today)
  if (budgetMode === 'total') {
    const total = days !== null ? draft.hoursPerDay * days : draft.totalHours
    return { ...draft, budgetMode, totalHours: Math.max(LIMITS.totalHours.min, roundQuarter(total)) }
  }
  const perDay = days !== null ? draft.totalHours / days : draft.hoursPerDay
  return {
    ...draft,
    budgetMode,
    hoursPerDay: clamp(roundQuarter(perDay), LIMITS.hoursPerDay.min, LIMITS.hoursPerDay.max)
  }
}

/** A copy of `record` with `key` set to `value`, or without `key` when `value` is null. */
function setOrRemove<T>(
  record: Readonly<Record<string, T>>,
  key: string,
  value: T | null
): Record<string, T> {
  const rest = Object.fromEntries(Object.entries(record).filter(([k]) => k !== key))
  return value === null ? rest : { ...rest, [key]: value }
}

/** Pins a topic to a level, or hands it back to the planner with null. */
export function withPin(draft: PlannerDraft, topicId: string, level: StudyLevel | null): PlannerDraft {
  return { ...draft, pins: setOrRemove(draft.pins, topicId, level) }
}

/** Overrides a topic's exam weight (0..1), or restores the AI estimate with null. */
export function withWeight(draft: PlannerDraft, topicId: string, weight: number | null): PlannerDraft {
  return {
    ...draft,
    weights: setOrRemove(draft.weights, topicId, weight === null ? null : clamp(weight, 0, 1))
  }
}

/** Topics the student changed by hand (a pin, a weight, or both). */
export function changedTopicCount(draft: PlannerDraft): number {
  return new Set([...Object.keys(draft.pins), ...Object.keys(draft.weights)]).size
}
