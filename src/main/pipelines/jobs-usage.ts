import { notFound } from './errors'
import type { Handlers, PipelineDeps } from './types'

/** How many jobs the job list shows: running and queued first, then recent history. */
export const JOB_LIST_LIMIT = 200

/** Background jobs and the usage ledger as the renderer sees them. */
export function createJobsUsage(deps: Pick<PipelineDeps, 'db' | 'queue' | 'now'>): {
  handlers: Pick<Handlers, 'jobs.list' | 'jobs.cancel' | 'usage.summary'>
} {
  const { db } = deps
  return {
    handlers: {
      'jobs.list': async ({ docId }) => db.jobs.list(docId, JOB_LIST_LIMIT),

      'jobs.cancel': async ({ jobId }) => {
        if (!db.jobs.get(jobId)) throw notFound('Job', jobId)
        deps.queue.cancel(jobId)
        return { ok: true }
      },

      'usage.summary': async () => db.usage.summary(deps.now().toISOString())
    }
  }
}
