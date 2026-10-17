/**
 * Exam triage model: what each study level of a topic is worth and what it costs.
 *
 * The planner gives every topic one of three levels: `skip`, `core` (only the essentials) or
 * `full`. For each level it needs two numbers. The first is the expected share of total exam
 * marks the student collects from the topic. The second is how many more minutes the level
 * takes. The solver (./search.ts) then picks one level per topic.
 *
 * Weights
 *   w = examWeight (or the user's override), normalised over all topics so that Σw = 1.
 *   If every weight is 0 the topics count equally.
 *
 * Accuracy (probability of answering the topic's questions right)
 *   guess  the accuracy without studying, by exam format: mcq 0.25, mixed 0.10, written/numeric 0.
 *   pCore  accuracy on the essentials after core study (0.85).
 *   pFull  accuracy on the whole topic after full study (0.90).
 *   Quiz evidence (a Beta belief, see ./belief.ts) can only lift these numbers. Each level's
 *   default works as a prior worth `beliefPriorWeight` quiz answers. The observed answers then pull
 *   the estimate toward the measured accuracy, and the result is never below the level default:
 *     acc(level) = max(default, (k × default + correct) / (k + correct + incorrect))
 *   The Beta(1, 1) starting prior of updateBelief is removed first, so one wrong answer cannot
 *   raise a score. Strong evidence of mastery makes even `skip` worth a lot. That is what lets the
 *   planner say "Already mastered" and spend the time elsewhere.
 *
 * Expected marks by level, with cf = coreFraction (the share of the topic's marks the essentials cover)
 *   skip  w × acc(guess)
 *   core  w × (cf × acc(pCore) + (1 − cf) × acc(guess))
 *   full  w × acc(pFull)
 *
 * Cost (remaining minutes, rounded up to 15-minute slots)
 *   core  max(0, coreMinutes − minutesSpent)
 *   full  max(0, max(fullMinutes, coreMinutes) − minutesSpent)
 *   Time already spent counts toward both levels, so a studied topic costs ~0.
 *
 * Budget (./budget.ts)
 *   totalHours × 60, else hoursPerDay × days until the exam, else a 10 h default. When both
 *   are known the smaller one wins. `reserveFraction` (20 %) of it is held back for page checks,
 *   spaced review and mock exams before the solver runs.
 *
 * Every constant lives in PLANNER_DEFAULTS so the UI can show and explain it.
 */
import type { ExamFormat, MasteryBelief, PlanInput, PlanTopic, StudyLevel } from './types'
import { levelAccuracy, observedAccuracy } from './belief'

export interface PlannerParams {
  /** Granularity of the knapsack, in minutes. Costs are rounded up to whole slots. */
  readonly slotMinutes: number
  /** Accuracy on a topic's essentials after studying its core. */
  readonly pCore: number
  /** Accuracy on a whole topic after studying it in full. */
  readonly pFull: number
  /** Accuracy without studying, by exam format (mcq guessing, partial credit in mixed exams). */
  readonly guess: Readonly<Record<ExamFormat, number>>
  /** How many quiz answers a level's default accuracy is worth when blending in quiz evidence. */
  readonly beliefPriorWeight: number
  /** Measured accuracy from which a topic counts as "already mastered" in reasons. */
  readonly masteredAccuracy: number
  /** Share of the budget held back for page checks, spaced review and mock exams. */
  readonly reserveFraction: number
  /** Budget when the input gives neither total hours nor hours per day with an exam date. */
  readonly defaultBudgetHours: number
  /**
   * Cap on the prerequisite branch-and-bound (relaxations solved). Real topic maps need a handful.
   * The cap only bounds pathological graphs; the best plan found so far is used.
   */
  readonly maxSearchNodes: number
  /** Schedule: daily study time when there is no exam date and no hours per day. */
  readonly defaultHoursPerDay: number
  /** Schedule: a derived daily limit (budget / days) never goes below this. */
  readonly minDayMinutes: number
  /** Schedule: longest single learn session; longer topics are split. */
  readonly maxLearnSessionMinutes: number
  /** Schedule: a check session after each learn session takes this share of its minutes. */
  readonly checkFraction: number
  readonly minCheckMinutes: number
  readonly mockMinutes: number
  readonly maxMockExams: number
  /** A mock exam is scheduled only when the review pool holds this many mock lengths per mock. */
  readonly mockPoolFactor: number
  readonly minReviewSessionMinutes: number
}

export const PLANNER_DEFAULTS: PlannerParams = Object.freeze({
  slotMinutes: 15,
  pCore: 0.85,
  pFull: 0.9,
  guess: Object.freeze({ mcq: 0.25, mixed: 0.1, written: 0, numeric: 0 }),
  beliefPriorWeight: 4,
  masteredAccuracy: 0.85,
  reserveFraction: 0.2,
  defaultBudgetHours: 10,
  maxSearchNodes: 400,
  defaultHoursPerDay: 2,
  minDayMinutes: 30,
  maxLearnSessionMinutes: 75,
  checkFraction: 0.1,
  minCheckMinutes: 5,
  mockMinutes: 60,
  maxMockExams: 2,
  mockPoolFactor: 1.5,
  minReviewSessionMinutes: 10
})

export interface LevelOption {
  level: StudyLevel
  /** Remaining minutes, rounded up to whole slots. */
  minutes: number
  slots: number
  /** Expected share of total exam marks, 0..1. */
  expectedMarks: number
}

export type LevelOptions = Record<StudyLevel, LevelOption>

/** Everything the solver, the reasons and the schedule need to know about one topic. */
export interface TopicModel {
  index: number
  topic: PlanTopic
  /** Normalised exam weight, 0..1. */
  weight: number
  coreFraction: number
  /** Accuracy if the topic gets no more study: the guess rate, lifted by quiz evidence. */
  currentAccuracy: number
  /** Share of quiz answers that were right (Beta(1, 1) start removed), null without quiz data. */
  quizAccuracy: number | null
  options: LevelOptions
  /** Level pinned by the user, if any. */
  forced: StudyLevel | null
}

const finiteOr = (x: number, fallback: number): number => (Number.isFinite(x) ? x : fallback)
const clamp01 = (x: number): number => Math.min(1, Math.max(0, finiteOr(x, 0)))

/** Minutes rounded up to whole slots. The epsilon keeps 30.0000001 from becoming 45. */
export function toSlots(minutes: number, slotMinutes: number): number {
  const m = Math.max(0, finiteOr(minutes, 0))
  return Math.max(0, Math.ceil(m / slotMinutes - 1e-9))
}

/** User overrides folded per topic; a later entry for the same topic wins field by field. */
export function overridesById(
  input: PlanInput
): Map<string, { level: StudyLevel | null; weight: number | null }> {
  const byId = new Map<string, { level: StudyLevel | null; weight: number | null }>()
  for (const o of input.overrides) {
    const cur = byId.get(o.topicId) ?? { level: null, weight: null }
    byId.set(o.topicId, {
      level: o.level ?? cur.level,
      weight: o.examWeight !== undefined && Number.isFinite(o.examWeight) ? o.examWeight : cur.weight
    })
  }
  return byId
}

/**
 * Normalised exam weights (Σ = 1). An override replaces the topic's estimate before
 * normalising. `rawSum` is the sum before normalising, which the solver uses for its notes.
 */
export function normaliseWeights(
  topics: PlanTopic[],
  input: PlanInput
): { weights: number[]; rawSum: number } {
  const overrides = overridesById(input)
  const raw = topics.map((t) => Math.max(0, finiteOr(overrides.get(t.id)?.weight ?? t.examWeight, 0)))
  const rawSum = raw.reduce((a, b) => a + b, 0)
  if (rawSum > 0) return { weights: raw.map((w) => w / rawSum), rawSum }
  return { weights: topics.map(() => (topics.length > 0 ? 1 / topics.length : 0)), rawSum }
}

/**
 * Value and remaining cost of each level for one topic (see the model at the top of this file).
 * `weight` is the normalised exam weight.
 */
export function levelOptions(
  topic: PlanTopic,
  weight: number,
  format: ExamFormat,
  params: PlannerParams = PLANNER_DEFAULTS
): LevelOptions {
  const belief: MasteryBelief | null = topic.mastery
  const cf = clamp01(topic.coreFraction)
  const skipAcc = levelAccuracy(params.guess[format], belief, params.beliefPriorWeight)
  const coreAcc = levelAccuracy(params.pCore, belief, params.beliefPriorWeight)
  const fullAcc = levelAccuracy(params.pFull, belief, params.beliefPriorWeight)

  const spent = Math.max(0, finiteOr(topic.minutesSpent, 0))
  const coreMinutes = Math.max(0, finiteOr(topic.coreMinutes, 0))
  const fullMinutes = Math.max(coreMinutes, finiteOr(topic.fullMinutes, 0))
  const option = (level: StudyLevel, minutesLeft: number, marks: number): LevelOption => {
    const slots = toSlots(minutesLeft, params.slotMinutes)
    return { level, slots, minutes: slots * params.slotMinutes, expectedMarks: marks }
  }
  return {
    skip: option('skip', 0, weight * skipAcc),
    core: option('core', coreMinutes - spent, weight * (cf * coreAcc + (1 - cf) * skipAcc)),
    full: option('full', fullMinutes - spent, weight * fullAcc)
  }
}

/** Builds the per-topic model shared by the solver and the schedule. */
export function modelTopics(
  topics: PlanTopic[],
  input: PlanInput,
  params: PlannerParams = PLANNER_DEFAULTS
): { models: TopicModel[]; rawWeightSum: number } {
  const { weights, rawSum } = normaliseWeights(topics, input)
  const overrides = overridesById(input)
  const models = topics.map((topic, index): TopicModel => {
    const weight = weights[index] ?? 0
    return {
      index,
      topic,
      weight,
      coreFraction: clamp01(topic.coreFraction),
      currentAccuracy: levelAccuracy(params.guess[input.format], topic.mastery, params.beliefPriorWeight),
      quizAccuracy: observedAccuracy(topic.mastery),
      options: levelOptions(topic, weight, input.format, params),
      forced: overrides.get(topic.id)?.level ?? null
    }
  })
  return { models, rawWeightSum: rawSum }
}

/** Scales time estimates by the student's pace (clamped to 0.5..2); 1 or absent leaves topics as they are. */
export function withPace(topics: PlanTopic[], pace: number | undefined): PlanTopic[] {
  const f = pace === undefined || !Number.isFinite(pace) ? 1 : Math.min(2, Math.max(0.5, pace))
  if (f === 1) return topics
  return topics.map((t) => ({ ...t, coreMinutes: t.coreMinutes * f, fullMinutes: t.fullMinutes * f }))
}
