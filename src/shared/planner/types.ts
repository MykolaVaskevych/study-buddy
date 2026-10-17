import type { IsoDate, PlanId, DocId, TopicId } from '../domain'

/**
 * Exam triage planner contract. Implementation: src/shared/planner (pure functions, no I/O).
 *
 *   solvePlan(topics, input, opts)            -> PlanResult  (which level per topic, expected score)
 *   buildSchedule(plan, topics, input, today) -> Schedule    (day-by-day sessions until the exam)
 */

/** How deep to study a topic. */
export type StudyLevel = 'skip' | 'core' | 'full'

export type PlanMode = 'max_score' | 'min_time'

export type ExamFormat = 'mcq' | 'written' | 'numeric' | 'mixed'

export interface PlanInput {
  examDate: IsoDate | null
  /** Total study hours available; if null, derived from hoursPerDay × days until exam. */
  totalHours: number | null
  hoursPerDay: number | null
  /** Target exam score 0..1 (used by 'min_time', reported against in 'max_score'). */
  targetScore: number
  mode: PlanMode
  format: ExamFormat
  overrides: TopicOverride[]
  /**
   * Share of the budget held back for page checks, spaced review and mock exams, 0..0.9.
   * Absent means PLANNER_DEFAULTS.reserveFraction. Part of the input so a saved plan keeps it.
   */
  reserveFraction?: number
  /**
   * The student's pace: multiplies every time estimate (0.75 = learns faster than estimated,
   * 1.5 = slower). Absent means 1.
   */
  pace?: number
}

export interface TopicOverride {
  topicId: TopicId
  /** Force a level (user pinned or skipped the topic). */
  level?: StudyLevel
  /** Replace the AI-estimated exam weight. */
  examWeight?: number
}

/** Beta(alpha, beta) belief about the probability of answering this topic's questions right. */
export interface MasteryBelief {
  alpha: number
  beta: number
}

export interface PlanTopic {
  id: TopicId
  title: string
  examWeight: number
  coreFraction: number
  coreMinutes: number
  fullMinutes: number
  prerequisites: TopicId[]
  /** Current belief from quizzes; null = no data yet. */
  mastery: MasteryBelief | null
  /** Minutes already spent studying this topic. */
  minutesSpent: number
}

export interface PlanItem {
  topicId: TopicId
  level: StudyLevel
  /** Remaining minutes to reach the level. */
  minutes: number
  /** Expected share of total marks from this topic at that level, 0..1. */
  expectedMarks: number
  /** One line for the UI, e.g. "Skipped: ~3 h for ~4 % of marks". */
  reason: string
  forcedBy: 'user' | 'prerequisite' | null
}

export interface PlanResult {
  feasible: boolean
  expectedScore: number
  targetScore: number
  /** Minutes available for learning (the study budget minus `reserveMinutes`). */
  budgetMinutes: number
  /** Minutes held back from the budget for page checks, spaced review and mock exams. */
  reserveMinutes: number
  plannedMinutes: number
  items: PlanItem[]
  /** Human-readable notes, e.g. "Target 80 % not reachable in 6 h; best is ~71 %". */
  notes: string[]
}

export type SessionKind = 'learn' | 'check' | 'review' | 'mock'

export interface StudySession {
  kind: SessionKind
  topicId: TopicId | null
  minutes: number
  level: StudyLevel | null
  label: string
}

export interface StudyDay {
  date: IsoDate
  sessions: StudySession[]
  totalMinutes: number
}

export interface Schedule {
  days: StudyDay[]
}

export interface ExamPlan {
  id: PlanId
  docId: DocId
  input: PlanInput
  result: PlanResult
  schedule: Schedule
  createdAt: IsoDate
  updatedAt: IsoDate
}
