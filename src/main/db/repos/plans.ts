import { eq } from 'drizzle-orm'
import type { ExamPlan } from '@shared/planner/types'
import { iso, type RepoContext } from '../context'
import { plans } from '../schema'
import type { PlanRepo } from '../types'

type PlanRow = typeof plans.$inferSelect

function toPlan(row: PlanRow): ExamPlan {
  return {
    id: row.id,
    docId: row.docId,
    input: row.input,
    result: row.result,
    schedule: row.schedule,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

export function createPlanRepo(ctx: RepoContext): PlanRepo {
  const { db } = ctx

  const get = (docId: string): ExamPlan | null => {
    const row = db.select().from(plans).where(eq(plans.docId, docId)).get()
    return row ? toPlan(row) : null
  }

  return {
    get,

    save(plan, now) {
      // One plan per document: re-saving keeps id and createdAt so links to the plan stay valid.
      const at = iso(now)
      const content = { input: plan.input, result: plan.result, schedule: plan.schedule, updatedAt: at }
      return ctx.tx(() => {
        db.insert(plans)
          .values({ docId: plan.docId, id: ctx.newId(), createdAt: at, ...content })
          .onConflictDoUpdate({ target: plans.docId, set: content })
          .run()
        const saved = get(plan.docId)
        if (!saved) throw new Error(`Plan for ${plan.docId} vanished while saving`)
        return saved
      })
    }
  }
}
