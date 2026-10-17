import type { DocId } from '@shared/domain'
import { buildSchedule, solvePlan } from '@shared/planner'
import type { ExamPlan, PlanInput, PlanTopic } from '@shared/planner/types'
import { localDate } from './dates'
import { messageOf } from './errors'
import { leafTopics, requireDoc } from './scope'
import { readingSpeedFactor } from './topics'
import type { Handlers, PipelineDeps } from './types'

/**
 * Exam planner service: leaf topics with estimates, mastery and time spent go into the pure solver
 * (src/shared/planner); the solved plan and its schedule are stored per document.
 */
export interface Planner {
  handlers: Pick<Handlers, 'plan.get' | 'plan.topics' | 'plan.save' | 'plan.today'>
  planTopics(docId: DocId): PlanTopic[]
  /** Re-solves a saved plan with its own input (after quizzes or a topic map rebuild). No-op without a plan. */
  replanIfSaved(docId: DocId): void
}

/** Fallbacks for topics the topic map gave no estimates. */
export const DERIVED_ESTIMATES = {
  coreMinutesPerPage: 1.2,
  fullMinutesPerPage: 3,
  coreFraction: 0.6
} as const

export function createPlanner(deps: Pick<PipelineDeps, 'db' | 'emit' | 'now'>): Planner {
  const { db } = deps

  const planTopics: Planner['planTopics'] = (docId) => {
    requireDoc(db, docId)
    const leaves = leafTopics(db.topics.list(docId))
    const ids = new Set(leaves.map((t) => t.id))
    const pagesOf = (t: { pageStart: number; pageEnd: number }): number =>
      Math.max(1, t.pageEnd - t.pageStart + 1)
    const totalPages = leaves.reduce((sum, t) => sum + pagesOf(t), 0)
    const speed = readingSpeedFactor(db.reading.averageSecondsPerPage(docId))
    return leaves.map((t) => {
      const est = t.estimates
      const pages = pagesOf(t)
      return {
        id: t.id,
        title: t.title,
        examWeight: est?.examWeight ?? pages / Math.max(1, totalPages),
        coreFraction: est?.coreFraction ?? DERIVED_ESTIMATES.coreFraction,
        coreMinutes: est?.coreMinutes ?? Math.round(pages * DERIVED_ESTIMATES.coreMinutesPerPage * speed),
        fullMinutes: est?.fullMinutes ?? Math.round(pages * DERIVED_ESTIMATES.fullMinutesPerPage * speed),
        // The solver works on leaves; a prerequisite chapter has no level of its own.
        prerequisites: (est?.prerequisites ?? []).filter((id) => ids.has(id) && id !== t.id),
        mastery: db.topics.mastery(t.id),
        minutesSpent: db.topics.minutesSpent(t.id)
      }
    })
  }

  const save = (docId: DocId, input: PlanInput): ExamPlan => {
    const topics = planTopics(docId)
    const now = deps.now()
    const today = localDate(now)
    const result = solvePlan(topics, input, { today })
    const schedule = buildSchedule(result, topics, input, today)
    const plan = db.plans.save({ docId, input, result, schedule }, now.toISOString())
    deps.emit('library.changed', { docId })
    return plan
  }

  return {
    planTopics,

    replanIfSaved(docId) {
      const plan = db.plans.get(docId)
      if (!plan) return
      try {
        const ids = new Set(leafTopics(db.topics.list(docId)).map((t) => t.id))
        // Overrides of topics that no longer exist (topic map rebuilt) would pin nothing.
        save(docId, { ...plan.input, overrides: plan.input.overrides.filter((o) => ids.has(o.topicId)) })
      } catch (err) {
        // A stale plan is better than failing the quiz or job that triggered the re-plan.
        console.warn(`[pipelines] re-plan of ${docId} failed: ${messageOf(err)}`)
      }
    },

    handlers: {
      'plan.get': async ({ docId }) => {
        requireDoc(db, docId)
        return db.plans.get(docId)
      },
      'plan.topics': async ({ docId }) => planTopics(docId),
      'plan.save': async ({ docId, input }) => save(docId, input),
      'plan.today': async ({ docId }) => {
        requireDoc(db, docId)
        const today = localDate(deps.now())
        return db.plans.get(docId)?.schedule.days.find((d) => d.date.slice(0, 10) === today) ?? null
      }
    }
  }
}
