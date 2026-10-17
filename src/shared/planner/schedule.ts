/**
 * Day-by-day schedule for a solved plan: learn → check → spaced review → mock exams near the exam.
 *
 * - Days: from `today` to the day before the exam. Without an exam date, as many days as the budget
 *   needs at hoursPerDay (or PLANNER_DEFAULTS.defaultHoursPerDay).
 * - Daily limit: hoursPerDay, else budget / days (never below minDayMinutes).
 * - Learn order: prerequisites first (topological), then by marks gained per minute. A topic may
 *   span days and is split into near-equal sessions of at most maxLearnSessionMinutes. Each learn
 *   session is followed by a check session (~10 % of its length, at least 5 m).
 * - The reserve (PlanResult.reserveMinutes) pays for the checks first, then up to two mock exams
 *   on the last days (if it holds mockPoolFactor mock lengths per mock), then daily spaced review
 *   that grows toward the exam.
 * - If learning doesn't fit, review shrinks first, then the mocks go, then sessions are cut in
 *   5-minute steps to fill every day. Only then does the daily limit grow, e.g. for pins beyond the
 *   budget, or limits under ~1 h where the 5-minute checks cost more than the reserve. All planned
 *   learn minutes are always scheduled.
 * Deterministic: the same input always gives the same schedule.
 */
import type { PlanInput, PlanResult, PlanTopic, Schedule, StudyDay, StudySession, StudyLevel } from './types'
import { PLANNER_DEFAULTS, modelTopics, withPace } from './model'
import { isoDayNumber, isoDayString } from './dates'

interface LearnUnit {
  topicId: string
  title: string
  level: StudyLevel
  minutes: number
  /** Preferred session length: the topic split into near-equal sessions. */
  chunk: number
}

interface Packed {
  /** Learn/check pairs per day, labels not yet numbered. */
  days: { unit: LearnUnit; learn: number; check: number }[][]
  used: number[]
  /** Learn minutes that did not fit. */
  overflow: number
}

const floor5 = (x: number): number => Math.max(0, Math.floor(x / 5 + 1e-9) * 5)
const ceil5 = (x: number): number => Math.max(0, Math.ceil(x / 5 - 1e-9) * 5)

/** Check session length after a learn session. */
function checkMinutes(learn: number): number {
  const p = PLANNER_DEFAULTS
  return Math.max(p.minCheckMinutes, Math.round((learn * p.checkFraction) / 5) * 5)
}

/** Studied topics in prerequisite order; among available topics, highest marks-per-minute first. */
function learnOrder(plan: PlanResult, topics: PlanTopic[], input: PlanInput): LearnUnit[] {
  const p = PLANNER_DEFAULTS
  const byId = new Map(topics.map((t) => [t.id, t]))
  const skipMarks = new Map<string, number>()
  for (const m of modelTopics(topics, input).models) skipMarks.set(m.topic.id, m.options.skip.expectedMarks)

  const items = plan.items.filter((it) => it.level !== 'skip' && it.minutes > 0)
  const ids = new Set(items.map((it) => it.topicId))
  const density = (i: number): number => {
    const it = items[i]
    return it ? (it.expectedMarks - (skipMarks.get(it.topicId) ?? 0)) / it.minutes : 0
  }
  const pending = items.map(
    (it) =>
      new Set((byId.get(it.topicId)?.prerequisites ?? []).filter((id) => ids.has(id) && id !== it.topicId))
  )
  const done = new Set<string>()
  const left = new Set(items.map((_, i) => i))
  const out: LearnUnit[] = []
  const idToIndex = new Map(items.map((it, i) => [it.topicId, i]))
  const unmet = (i: number): number[] =>
    [...(pending[i] ?? [])].filter((id) => !done.has(id)).map((id) => idToIndex.get(id) ?? -1)
  /** True if `from` reaches `to` along unmet prerequisite edges. */
  const reaches = (from: number, to: number): boolean => {
    const seen = new Set([from])
    const stack = [from]
    while (stack.length > 0) {
      for (const q of unmet(stack.pop() ?? -1)) {
        if (q === to) return true
        if (q >= 0 && !seen.has(q)) {
          seen.add(q)
          stack.push(q)
        }
      }
    }
    return false
  }
  const better = (i: number, cur: number): boolean =>
    cur < 0 || density(i) > density(cur) || (density(i) === density(cur) && i < cur)
  while (left.size > 0) {
    let pick = -1
    for (const i of left) if (unmet(i).length === 0 && better(i, pick)) pick = i
    if (pick < 0) {
      // Only a prerequisite cycle leaves nothing ready. Release the best topic whose unmet
      // prerequisites all lie on cycles through it, so that only the unavoidable cycle edges break.
      for (const i of left) if (unmet(i).every((q) => reaches(q, i)) && better(i, pick)) pick = i
    }
    const i = pick
    left.delete(i)
    const it = items[i]
    if (!it) continue
    done.add(it.topicId)
    const sessions = Math.max(1, Math.ceil(it.minutes / p.maxLearnSessionMinutes))
    out.push({
      topicId: it.topicId,
      title: byId.get(it.topicId)?.title ?? it.topicId,
      level: it.level,
      minutes: it.minutes,
      chunk: Math.ceil(it.minutes / sessions / p.slotMinutes) * p.slotMinutes
    })
  }
  return out
}

/** Greedy packing of learn + check pairs into days in order. */
function pack(units: LearnUnit[], capacity: number[], step: number = PLANNER_DEFAULTS.slotMinutes): Packed {
  const days: Packed['days'] = capacity.map(() => [])
  const used = capacity.map(() => 0)
  let u = 0
  let left = units[0]?.minutes ?? 0
  for (let d = 0; d < capacity.length && u < units.length; d++) {
    let room = capacity[d] ?? 0
    while (u < units.length) {
      const unit = units[u]
      if (!unit) break
      let take = Math.min(unit.chunk, left)
      while (take > 0 && take + checkMinutes(take) > room) take = take > step ? take - step : 0
      if (take <= 0) break
      const check = checkMinutes(take)
      days[d]?.push({ unit, learn: take, check })
      room -= take + check
      used[d] = (used[d] ?? 0) + take + check
      left -= take
      if (left <= 0) {
        u++
        left = units[u]?.minutes ?? 0
      }
    }
  }
  let overflow = left
  for (let k = u + 1; k < units.length; k++) overflow += units[k]?.minutes ?? 0
  return { days, used, overflow: u < units.length ? overflow : 0 }
}

/**
 * Builds the day-by-day schedule for a plan from solvePlan. `today` is an ISO date (YYYY-MM-DD).
 * Every planned learn minute is scheduled. Each day stays within the daily limit unless the plan
 * itself is larger than the calendar allows (e.g. pinned topics beyond the budget).
 */
export function buildSchedule(plan: PlanResult, raw: PlanTopic[], input: PlanInput, today: string): Schedule {
  const topics = withPace(raw, input.pace)
  const p = PLANNER_DEFAULTS
  const start = isoDayNumber(today)
  if (start === null) throw new RangeError(`buildSchedule: today must be an ISO date, got "${today}"`)

  const total = Math.max(0, plan.budgetMinutes + plan.reserveMinutes)
  const perDayInput =
    input.hoursPerDay !== null && input.hoursPerDay > 0 ? Math.round(input.hoursPerDay * 60) : null
  const exam = input.examDate !== null ? isoDayNumber(input.examDate) : null
  const dayCount =
    exam !== null
      ? Math.max(1, exam - start)
      : Math.max(1, Math.ceil(total / (perDayInput ?? p.defaultHoursPerDay * 60) - 1e-9))
  const cap = perDayInput ?? Math.max(p.minDayMinutes, ceil5(total / dayCount))

  const units = learnOrder(plan, topics, input)
  const estimatedChecks = units.reduce((s, u) => {
    const full = Math.floor(u.minutes / u.chunk)
    const rest = u.minutes - full * u.chunk
    return s + full * checkMinutes(u.chunk) + (rest > 0 ? checkMinutes(rest) : 0)
  }, 0)
  const pool = Math.max(0, plan.reserveMinutes - estimatedChecks)
  const mockFits = cap >= p.mockMinutes
  const plannedMocks = mockFits
    ? Math.min(p.maxMockExams, dayCount, Math.floor(pool / (p.mockMinutes * p.mockPoolFactor)))
    : 0
  const ramp = Array.from({ length: dayCount }, (_, d) => (dayCount > 1 ? 1 + d / (dayCount - 1) : 1))
  const rampSum = ramp.reduce((a, b) => a + b, 0)
  const reviewPool = Math.max(0, pool - plannedMocks * p.mockMinutes)
  const reviewTarget = ramp.map((w) => floor5((reviewPool * w) / rampSum))
  const mockOn = (d: number, mocks: number): number => (d >= dayCount - mocks ? p.mockMinutes : 0)

  // Fit the learning: shrink review, then drop mocks, then raise the daily limit.
  let mocks = plannedMocks
  let dayCap = cap
  let packed: Packed | null = null
  for (const [scale, m] of [
    [1, plannedMocks],
    [0.5, plannedMocks],
    [0, plannedMocks],
    [0, 0]
  ] as const) {
    const attempt = pack(
      units,
      ramp.map((_, d) => Math.max(0, cap - mockOn(d, m) - floor5((reviewTarget[d] ?? 0) * scale)))
    )
    if (attempt.overflow === 0) {
      packed = attempt
      mocks = m
      break
    }
  }
  if (!packed) {
    // Last resort before a longer day: fill every day in 5-minute steps instead of whole slots.
    const attempt = pack(
      units,
      ramp.map(() => cap),
      5
    )
    if (attempt.overflow === 0) {
      packed = attempt
      mocks = 0
    }
  }
  while (!packed) {
    const attempt = pack(
      units,
      ramp.map(() => dayCap),
      5
    )
    if (attempt.overflow === 0) {
      packed = attempt
      mocks = 0
    } else
      dayCap += Math.max(
        p.slotMinutes,
        Math.ceil(attempt.overflow / dayCount / p.slotMinutes) * p.slotMinutes
      )
  }

  // Review gets what the reserve has left after checks and mocks, spread along the ramp.
  const checks = packed.days.flat().reduce((s, x) => s + x.check, 0)
  let reviewLeft = Math.max(0, plan.reserveMinutes - checks - mocks * p.mockMinutes)
  const free = packed.used.map((u, d) => Math.max(0, dayCap - u - mockOn(d, mocks)))
  const review = ramp.map((w, d) => Math.min(free[d] ?? 0, floor5((reviewLeft * w) / rampSum)))
  reviewLeft -= review.reduce((a, b) => a + b, 0)
  for (let d = dayCount - 1; d >= 0 && reviewLeft >= 5; d--) {
    const add = floor5(Math.min(reviewLeft, (free[d] ?? 0) - (review[d] ?? 0)))
    review[d] = (review[d] ?? 0) + add
    reviewLeft -= add
  }

  // Number the learn sessions per topic: "Learn (core): Chromatic dispersion (2/3)".
  const parts = new Map<string, number>()
  for (const x of packed.days.flat()) parts.set(x.unit.topicId, (parts.get(x.unit.topicId) ?? 0) + 1)
  const seen = new Map<string, number>()

  const days: StudyDay[] = packed.days.map((pairs, d) => {
    const sessions: StudySession[] = []
    const r = review[d] ?? 0
    if (r >= p.minReviewSessionMinutes) {
      sessions.push({ kind: 'review', topicId: null, minutes: r, level: null, label: 'Review due cards' })
    }
    for (const { unit, learn, check } of pairs) {
      const k = (seen.get(unit.topicId) ?? 0) + 1
      seen.set(unit.topicId, k)
      const of = parts.get(unit.topicId) ?? 1
      const suffix = of > 1 ? ` (${k}/${of})` : ''
      sessions.push({
        kind: 'learn',
        topicId: unit.topicId,
        minutes: learn,
        level: unit.level,
        label: `Learn (${unit.level}): ${unit.title}${suffix}`
      })
      sessions.push({
        kind: 'check',
        topicId: unit.topicId,
        minutes: check,
        level: unit.level,
        label: `Check: page quiz (${unit.title})`
      })
    }
    if (mockOn(d, mocks) > 0) {
      sessions.push({ kind: 'mock', topicId: null, minutes: p.mockMinutes, level: null, label: 'Mock exam' })
    }
    return {
      date: isoDayString(start + d),
      sessions,
      totalMinutes: sessions.reduce((s, x) => s + x.minutes, 0)
    }
  })
  return { days }
}
