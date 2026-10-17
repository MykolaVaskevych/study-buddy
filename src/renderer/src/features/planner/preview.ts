import { buildSchedule, solvePlan } from '@shared/planner'
import type { PlanInput, PlanResult, PlanTopic, Schedule } from '@shared/planner'

/** A solved plan and its schedule, computed in the renderer while the student edits. */
export interface Preview {
  input: PlanInput
  result: PlanResult
  schedule: Schedule
}

/** Runs the pure solver and schedule for one input. `today` is the local YYYY-MM-DD day. */
export function computePreview(topics: PlanTopic[], input: PlanInput, today: string): Preview {
  const result = solvePlan(topics, input, { today })
  return { input, result, schedule: buildSchedule(result, topics, input, today) }
}

/** Minutes in a formatMinutes string ("13 h 15 m", "40 m", "3 h"), or null if it isn't one. */
export function parseDuration(text: string): number | null {
  const m = /^\s*(?:(\d+) h)?\s*(?:(\d+) m)?\s*$/.exec(text)
  if (!m || (m[1] === undefined && m[2] === undefined)) return null
  return Number(m[1] ?? 0) * 60 + Number(m[2] ?? 0)
}

/**
 * Total study minutes the solver says would reach the target ("… About 13 h 15 m would get there."),
 * or null when its notes don't name one.
 */
export function neededMinutes(notes: readonly string[]): number | null {
  for (const note of notes) {
    const m = /About (.+?) would get there/.exec(note)
    const minutes = m?.[1] !== undefined ? parseDuration(m[1]) : null
    if (minutes !== null && minutes > 0) return minutes
  }
  return null
}

/** True when the notes say the target is above what studying everything gives. */
export function targetOutOfReach(notes: readonly string[]): boolean {
  return notes.some((n) => n.includes('Even studying everything in full'))
}

export interface NoteGroups {
  /** "Target … not reachable …" or "Expected …" / "Target … reached …": the headline's sentence. */
  outcome: string | null
  /** Where the time comes from and what the reserve keeps. Shown with the time breakdown. */
  budget: string[]
  /** Everything else worth a look: default budget, rescaled weights, pins over budget, skipped prerequisites. */
  other: string[]
}

/** Sorts the solver's notes into the places the screen shows them. */
export function groupNotes(notes: readonly string[]): NoteGroups {
  const groups: NoteGroups = { outcome: null, budget: [], other: [] }
  for (const note of notes) {
    if (groups.outcome === null && /^(Target \d|Expected )/.test(note)) groups.outcome = note
    else if (note.startsWith('Budget:') || note.startsWith('Kept ')) groups.budget.push(note)
    else groups.other.push(note)
  }
  return groups
}

/**
 * Hours per day that cover `minutes` of study over `days` days, rounded up to 15 minutes so the
 * budget never falls short of what the solver asked for.
 */
export function hoursPerDayFor(minutes: number, days: number): number {
  const perDay = Math.ceil(minutes / Math.max(1, days) / 15) * 15
  return perDay / 60
}

/** The best expected score this input can reach with unlimited time (pins and weights still apply). */
export function bestReachable(topics: PlanTopic[], input: PlanInput): number {
  // Every level of every topic fits; the extra slot per topic covers rounding up to 15-minute slots.
  const everything = topics.reduce((s, t) => s + Math.max(t.coreMinutes, t.fullMinutes) + 15, 0)
  return solvePlan(topics, { ...input, mode: 'max_score' }, { budgetMinutes: everything, reserveFraction: 0 })
    .expectedScore
}
