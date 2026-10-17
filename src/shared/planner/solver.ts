import type { PlanInput, PlanItem, PlanResult, PlanTopic, StudyLevel } from './types'
import { PLANNER_DEFAULTS, modelTopics, type PlannerParams, type TopicModel } from './model'
import { resolveBudget, type BudgetInfo } from './budget'
import { approxPercent, formatMinutes, formatPercent } from './format'
import {
  ALL_LEVELS,
  LEVELS,
  LEVEL_BIT,
  SCORE_SCALE,
  SKIP,
  levelIndex,
  quantise,
  searchPlan,
  type SearchTopic
} from './search'

export interface SolveOptions {
  /** Total study minutes, before the review reserve. Replaces the budget derived from the input. */
  budgetMinutes?: number
  /** ISO date for counting days until the exam. Without it only totalHours (or the default) can apply. */
  today?: string
  /**
   * Share of the budget held back for checks, review and mocks. Wins over `input.reserveFraction`;
   * without either, PLANNER_DEFAULTS.reserveFraction.
   */
  reserveFraction?: number
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Number.isFinite(x) ? x : lo))

interface Budget {
  totalMinutes: number
  info: BudgetInfo | null
}

function budgetNote(budget: Budget, input: PlanInput, params: PlannerParams): string {
  const total = formatMinutes(budget.totalMinutes)
  const info = budget.info
  if (!info) return `Budget: ${total}.`
  const perDay = `${info.days ?? 1} day${info.days === 1 ? '' : 's'} × ${formatMinutes((input.hoursPerDay ?? 0) * 60)}/day`
  switch (info.source) {
    case 'total':
      return `Budget: ${total}.`
    case 'daily':
      return `Budget: ${perDay} = ${total} until the exam.`
    case 'capped':
      return `Budget: ${perDay} = ${total}, less than the ${formatMinutes((input.totalHours ?? 0) * 60)} you entered.`
    case 'default': {
      const why =
        info.problem === 'no_exam_date'
          ? 'Hours per day need an exam date'
          : info.problem === 'bad_exam_date'
            ? `The exam date "${input.examDate ?? ''}" is not a valid date`
            : info.problem === 'no_today'
              ? "Days until the exam can't be counted without today's date"
              : 'No study time given'
      return `${why}; assumed ${formatMinutes(params.defaultBudgetHours * 60)}. Set total hours or hours per day.`
    }
  }
}

interface ReasonContext {
  mode: PlanInput['mode']
  target: number
  reachedTarget: boolean
  budgetSlots: number
  freeSlots: number
  topicCount: number
  /** Lowest marks-per-minute gain among topics the solver chose freely; Infinity if none. */
  minChosenDensity: number
  params: PlannerParams
}

const gainPerMinute = (m: TopicModel, level: StudyLevel): number => {
  const o = m.options[level]
  return o.minutes > 0 ? (o.expectedMarks - m.options.skip.expectedMarks) / o.minutes : Infinity
}

function skipReason(m: TopicModel, ctx: ReasonContext): string {
  const { core, full } = m.options
  const mastered = ctx.params.masteredAccuracy
  if (m.weight <= 1e-9) return 'Skipped: not expected on the exam'
  if (m.quizAccuracy !== null && m.quizAccuracy >= mastered) {
    if (m.currentAccuracy >= mastered) return `Already mastered (quizzes ${approxPercent(m.quizAccuracy)})`
    const gain = full.expectedMarks - m.options.skip.expectedMarks
    return `Skipped: quizzes already show ${approxPercent(m.quizAccuracy)}; full study adds ${approxPercent(gain)} of marks for ${formatMinutes(full.minutes)}`
  }
  const whole = `~${formatMinutes(full.minutes)} for ${approxPercent(m.weight)} of marks`
  if (ctx.budgetSlots === 0) {
    return `Skipped: no study time in the budget (essentials take ${formatMinutes(core.minutes)} for ${approxPercent(m.weight * m.coreFraction)} of marks)`
  }
  if (ctx.mode === 'min_time' && ctx.reachedTarget) {
    return `Skipped: not needed for your ${formatPercent(ctx.target)} target (${whole})`
  }
  const cheapest = core.slots > 0 ? core : full
  const density = Math.max(gainPerMinute(m, 'core'), gainPerMinute(m, 'full'))
  if (cheapest.slots > ctx.freeSlots && density >= ctx.minChosenDensity) {
    return `Skipped: didn't fit in the time left (${whole})`
  }
  return `Skipped: ${whole}`
}

function reasonFor(
  m: TopicModel,
  level: StudyLevel,
  forcedBy: PlanItem['forcedBy'],
  requiredBy: string[],
  ctx: ReasonContext
): string {
  const option = m.options[level]
  const share = level === 'full' ? m.weight : level === 'core' ? m.weight * m.coreFraction : 0
  if (forcedBy === 'user') {
    if (level === 'skip') return 'You set this'
    if (option.minutes === 0) return 'You set this (already studied)'
    return `You set this (${formatMinutes(option.minutes)} for ${approxPercent(share)} of marks)`
  }
  if (forcedBy === 'prerequisite') {
    const more = requiredBy.length > 1 ? ` and ${requiredBy.length - 1} more` : ''
    return `Required by '${requiredBy[0] ?? ''}'${more} (prerequisite)`
  }
  if (level === 'skip') return skipReason(m, ctx)
  const needed = requiredBy.length > 0 ? `; needed for '${requiredBy[0] ?? ''}'` : ''
  return studiedReason(m, level, ctx) + needed
}

function studiedReason(m: TopicModel, level: 'core' | 'full', ctx: ReasonContext): string {
  const option = m.options[level]
  if (option.minutes === 0) {
    if (m.quizAccuracy !== null && m.quizAccuracy >= ctx.params.masteredAccuracy) {
      return `Already mastered (quizzes ${approxPercent(m.quizAccuracy)})`
    }
    if (level === 'full') return 'Already studied in full'
    const extra = m.options.full.minutes
    return extra > 0
      ? `Essentials already studied; full needs ${formatMinutes(extra)} more`
      : 'Essentials already studied'
  }
  if (level === 'core') {
    const extra = m.options.full.minutes - option.minutes
    const tail = extra > 0 ? `; full needs ${formatMinutes(extra)} more` : ''
    return `Core only: essentials give ${approxPercent(m.coreFraction)} of this topic's marks in ${formatMinutes(option.minutes)}${tail}`
  }
  // "High value": at least 10 % of marks, or 1.5× an average topic in large documents.
  const high = m.weight >= Math.min(0.1, 1.5 / Math.max(1, ctx.topicCount))
  return high
    ? `Full: high value (${approxPercent(m.weight)} of marks), ${formatMinutes(option.minutes)}`
    : `Full: ${approxPercent(m.weight)} of marks for ${formatMinutes(option.minutes)}`
}

/**
 * Decides per topic whether to study it fully, only its essentials, or skip it.
 *
 * - `max_score`: the most expected marks within the learning budget.
 * - `min_time`:  the least learning time whose expected score reaches `targetScore`. If the budget
 *   cannot reach it, the max-score plan comes back with `feasible: false` and a note.
 * User pins always win, and their cost is taken first. Prerequisites of studied topics are studied
 * at least at core, except prerequisites the user pinned to skip. Those are reported in the notes.
 * See ./model.ts for the value and cost model and ./search.ts for the exact solver.
 */
export function solvePlan(topics: PlanTopic[], input: PlanInput, opts: SolveOptions = {}): PlanResult {
  const params = PLANNER_DEFAULTS
  const slot = params.slotMinutes
  const target = clamp(input.targetScore, 0, 1)
  const notes: string[] = []

  const budget: Budget =
    opts.budgetMinutes !== undefined && Number.isFinite(opts.budgetMinutes)
      ? { totalMinutes: Math.max(0, Math.round(opts.budgetMinutes)), info: null }
      : (() => {
          const info = resolveBudget(input, opts.today, params)
          return { totalMinutes: info.minutes, info }
        })()
  const reserveFraction = clamp(
    opts.reserveFraction ?? input.reserveFraction ?? params.reserveFraction,
    0,
    0.9
  )
  const reserveMinutes = Math.round(budget.totalMinutes * reserveFraction)
  const learnMinutes = budget.totalMinutes - reserveMinutes
  const budgetSlots = Math.floor(learnMinutes / slot + 1e-9)
  notes.push(budgetNote(budget, input, params))
  if (reserveMinutes > 0) {
    notes.push(
      `Kept ${formatMinutes(reserveMinutes)} (${formatPercent(reserveFraction)}) for page checks, spaced review and mock exams; ${formatMinutes(learnMinutes)} for learning.`
    )
  }

  const { models, rawWeightSum } = modelTopics(topics, input, params)
  const base = { targetScore: target, budgetMinutes: learnMinutes, reserveMinutes }
  if (models.length === 0) {
    notes.push('No topics yet; build the topic map first.')
    return { ...base, feasible: target <= 0, expectedScore: 0, plannedMinutes: 0, items: [], notes }
  }
  if (rawWeightSum <= 0) notes.push('No exam weights known; all topics count the same.')
  else if (Math.abs(rawWeightSum - 1) > 0.05) {
    notes.push(`Exam weights added up to ${formatPercent(rawWeightSum)}; rescaled to 100 %.`)
  }

  // Prerequisite edges. Unknown ids and self-references are ignored. An edge to a topic the user
  // pinned to skip is not enforced; it is reported instead.
  const indexById = new Map<string, number>()
  models.forEach((m) => {
    if (!indexById.has(m.topic.id)) indexById.set(m.topic.id, m.index)
  })
  const exempt: [number, number][] = []
  const prereqs = models.map((m) => {
    const out: number[] = []
    for (const id of m.topic.prerequisites) {
      const p = indexById.get(id)
      if (p === undefined || p === m.index || out.includes(p)) continue
      if (models[p]?.forced === 'skip') exempt.push([m.index, p])
      else out.push(p)
    }
    return out
  })

  const searchTopics: SearchTopic[] = models.map((m, i) => {
    const { skip, core, full } = m.options
    return {
      slots: [skip.slots, core.slots, full.slots],
      value: [quantise(skip.expectedMarks), quantise(core.expectedMarks), quantise(full.expectedMarks)],
      allowed: m.forced ? (LEVEL_BIT[levelIndex(m.forced)] ?? ALL_LEVELS) : ALL_LEVELS,
      prereqs: prereqs[i] ?? []
    }
  })
  const result = searchPlan({
    topics: searchTopics,
    budgetSlots,
    mode: input.mode,
    targetValue: quantise(target),
    maxNodes: params.maxSearchNodes
  })

  const levels = result.levels.map((lv) => LEVELS[lv] ?? 'skip')
  const studied = (i: number): boolean => (result.levels[i] ?? SKIP) !== SKIP
  const requiredBy = models.map(() => [] as string[])
  prereqs.forEach((ps, i) => {
    if (!studied(i)) return
    for (const p of ps) requiredBy[p]?.push(models[i]?.topic.title ?? '')
  })
  // A studied prerequisite counts as "forced" when it earns fewer marks per minute than the topics
  // the solver picked on their own merit, i.e. it is in the plan because a dependent needs it.
  const density = (i: number): number => {
    const m = models[i]
    return m ? gainPerMinute(m, levels[i] ?? 'skip') : Infinity
  }
  const free = models.filter((m, i) => !m.forced && studied(i) && m.options[levels[i] ?? 'skip'].minutes > 0)
  const independent = free
    .filter((m) => (requiredBy[m.index]?.length ?? 0) === 0)
    .map((m) => density(m.index))
  const dependentsDensity = (i: number): number =>
    Math.min(
      ...models.filter((d, j) => studied(j) && (prereqs[j] ?? []).includes(i)).map((d) => density(d.index))
    )
  const forcedBy = models.map((m, i): PlanItem['forcedBy'] => {
    if (m.forced) return 'user'
    if (!studied(i) || (requiredBy[i]?.length ?? 0) === 0) return null
    if (result.required[i]) return 'prerequisite'
    const bar = independent.length > 0 ? Math.min(...independent) : dependentsDensity(i)
    return density(i) < bar ? 'prerequisite' : null
  })
  let minChosenDensity = Infinity
  free.forEach((m) => {
    if (forcedBy[m.index] === null) minChosenDensity = Math.min(minChosenDensity, density(m.index))
  })
  const plannedMinutes = result.slots * slot
  const expectedScore = models.reduce((s, m, i) => s + m.options[levels[i] ?? 'skip'].expectedMarks, 0)
  const ctx: ReasonContext = {
    mode: input.mode,
    target,
    reachedTarget: result.reachedTarget,
    budgetSlots,
    freeSlots: Math.max(0, budgetSlots - result.slots),
    topicCount: models.length,
    minChosenDensity,
    params
  }
  const items: PlanItem[] = models.map((m, i) => {
    const level = levels[i] ?? 'skip'
    const option = m.options[level]
    const by = forcedBy[i] ?? null
    return {
      topicId: m.topic.id,
      level,
      minutes: option.minutes,
      expectedMarks: option.expectedMarks,
      reason: reasonFor(m, level, by, requiredBy[i] ?? [], ctx),
      forcedBy: by
    }
  })

  // Notes about the outcome.
  const overBudget = result.mandatorySlots > budgetSlots
  if (overBudget) {
    notes.push(
      `Your pinned topics and their prerequisites need ${formatMinutes(result.mandatorySlots * slot)}, more than the ${formatMinutes(learnMinutes)} available for learning.`
    )
  }
  if (result.reachedTarget) {
    if (input.mode === 'min_time') {
      const spare = learnMinutes - plannedMinutes
      const tail = spare >= slot ? `; ${formatMinutes(spare)} of learning time to spare` : ''
      notes.push(
        `Target ${formatPercent(target)} reached with ${formatMinutes(plannedMinutes)} of learning${tail}.`
      )
    } else {
      notes.push(
        `Expected ${approxPercent(expectedScore)}, at or above your ${formatPercent(target)} target.`
      )
    }
  } else {
    notes.push(
      `Target ${formatPercent(target)} not reachable in ${formatMinutes(budget.totalMinutes)}; best is ${approxPercent(expectedScore)}.${neededNote(searchTopics, target, reserveFraction, params)}`
    )
  }
  for (const [i, p] of exempt) {
    if (studied(i)) {
      notes.push(
        `'${models[i]?.topic.title ?? ''}' builds on '${models[p]?.topic.title ?? ''}', which you chose to skip.`
      )
    }
  }
  if (result.truncated)
    notes.push('Large prerequisite graph: this is the best plan found within the search limit.')

  return {
    ...base,
    feasible: result.reachedTarget && !overBudget,
    expectedScore,
    plannedMinutes,
    items,
    notes
  }
}

/** " About 9 h would get there." / " Even studying everything in full gives ~88 %." */
function neededNote(
  topics: SearchTopic[],
  target: number,
  reserveFraction: number,
  params: PlannerParams
): string {
  const allSlots = topics.reduce((s, t) => {
    let most = 0
    for (let lv = 0; lv < 3; lv++) {
      if ((t.allowed & (LEVEL_BIT[lv] ?? 0)) !== 0) most = Math.max(most, t.slots[lv as 0 | 1 | 2])
    }
    return s + most
  }, 0)
  const r = searchPlan({
    topics,
    budgetSlots: allSlots,
    mode: 'min_time',
    targetValue: quantise(target),
    maxNodes: Math.ceil(params.maxSearchNodes / 4)
  })
  if (!r.reachedTarget) {
    return ` Even studying everything in full gives ${approxPercent(r.value / SCORE_SCALE)}.`
  }
  const learn = r.slots * params.slotMinutes
  const total = Math.ceil(learn / (1 - reserveFraction) / params.slotMinutes - 1e-9) * params.slotMinutes
  return ` About ${formatMinutes(total)} would get there.`
}
