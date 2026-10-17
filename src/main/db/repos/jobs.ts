import { and, asc, desc, eq, gt, inArray, isNull, lte, min, notInArray, or, sql, type SQL } from 'drizzle-orm'
import type { JobInfo, JobKind } from '@shared/domain'
import { clampLimit, iso, NotFoundError, type RepoContext } from '../context'
import { jobs } from '../schema'
import type { JobRepo, JobRow } from '../types'

type Row = typeof jobs.$inferSelect

/** States that still have work ahead of them (what dedupe and the queue care about). */
const ACTIVE_STATES = ['queued', 'running', 'paused'] as const

function toRow(row: Row): JobRow {
  return {
    id: row.id,
    kind: row.kind,
    docId: row.docId,
    payload: row.payload,
    priority: row.priority,
    dedupeKey: row.dedupeKey,
    state: row.state,
    progress: row.progress,
    label: row.label,
    error: row.error,
    attempts: row.attempts,
    runAfter: row.runAfter,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

function toInfo(row: Row): JobInfo {
  return {
    id: row.id,
    kind: row.kind,
    docId: row.docId,
    state: row.state,
    progress: row.progress,
    label: row.label,
    error: row.error,
    attempts: row.attempts,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}

const notExcluded = (kinds: JobKind[] | undefined): SQL | undefined =>
  kinds && kinds.length > 0 ? notInArray(jobs.kind, kinds) : undefined

export function createJobRepo(ctx: RepoContext): JobRepo {
  const { db } = ctx

  const get = (id: string): JobRow | null => {
    const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
    return row ? toRow(row) : null
  }

  return {
    insert(job, now) {
      const at = iso(now)
      const id = ctx.newId()
      db.insert(jobs)
        .values({
          id,
          kind: job.kind,
          docId: job.docId,
          payload: job.payload ?? null,
          priority: job.priority,
          dedupeKey: job.dedupeKey,
          state: 'queued',
          progress: 0,
          label: job.label,
          error: null,
          attempts: 0,
          runAfter: job.runAfter === null ? null : iso(job.runAfter),
          createdAt: at,
          updatedAt: at
        })
        .run()
      const row = get(id)
      if (!row) throw new NotFoundError('Job', id)
      return row
    },

    findActive(dedupeKey) {
      const row = db
        .select()
        .from(jobs)
        .where(and(eq(jobs.dedupeKey, dedupeKey), inArray(jobs.state, [...ACTIVE_STATES])))
        .orderBy(asc(jobs.createdAt))
        .get()
      return row ? toRow(row) : null
    },

    nextRunnable(now, excludeKinds) {
      const row = db
        .select()
        .from(jobs)
        .where(
          and(
            eq(jobs.state, 'queued'),
            or(isNull(jobs.runAfter), lte(jobs.runAfter, iso(now))),
            notExcluded(excludeKinds)
          )
        )
        // rowid breaks createdAt ties (same-millisecond enqueues) in insertion order.
        .orderBy(desc(jobs.priority), asc(jobs.createdAt), asc(sql`rowid`))
        .get()
      return row ? toRow(row) : null
    },

    nextRunAfter(now, excludeKinds) {
      const row = db
        .select({ at: min(jobs.runAfter) })
        .from(jobs)
        .where(and(eq(jobs.state, 'queued'), gt(jobs.runAfter, iso(now)), notExcluded(excludeKinds)))
        .get()
      return row?.at ?? null
    },

    update(id, patch, now) {
      const set = {
        ...patch,
        ...(patch.runAfter !== undefined
          ? { runAfter: patch.runAfter === null ? null : iso(patch.runAfter) }
          : {}),
        updatedAt: iso(now)
      }
      const changes = db.update(jobs).set(set).where(eq(jobs.id, id)).run().changes
      const row = changes > 0 ? get(id) : null
      if (!row) throw new NotFoundError('Job', id)
      return row
    },

    get,

    list(docId, limit) {
      // Running first, then waiting work by priority, then history newest first.
      const stateOrder = sql`case ${jobs.state} when 'running' then 0 when 'queued' then 1 when 'paused' then 1 else 2 end`
      const activePriority = sql`case when ${jobs.state} in ('running', 'queued', 'paused') then ${jobs.priority} else 0 end`
      return db
        .select()
        .from(jobs)
        .where(docId === null ? undefined : eq(jobs.docId, docId))
        .orderBy(asc(stateOrder), desc(activePriority), desc(jobs.updatedAt), asc(sql`rowid`))
        .limit(clampLimit(limit))
        .all()
        .map(toInfo)
    },

    requeueInterrupted(now) {
      return db
        .update(jobs)
        .set({ state: 'queued', updatedAt: iso(now) })
        .where(eq(jobs.state, 'running'))
        .run().changes
    }
  }
}
