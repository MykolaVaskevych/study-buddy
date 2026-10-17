import type { JobId, JobInfo, RateLimitInfo } from '@shared/domain'
import type { JobQueue } from '../jobs/types'
import { jobFailure } from './errors'
import { ServiceError } from './types'

/**
 * Lets a request wait for background work (a page check, quiz questions) without hanging on a rate
 * limit: while the queue is paused nothing starts, possibly for many minutes, so a waiting request
 * fails fast with 'rate_limited' instead. The job itself stays queued and finishes after the reset,
 * which makes the retry instant.
 */
export interface JobWaiter {
  /** Resolves with the finished job; ServiceError if it failed or was cancelled, or the AI is rate limited. */
  done(jobId: JobId): Promise<JobInfo>
  /** Current rate-limit pause, or null. */
  rateLimit(): RateLimitInfo | null
}

const DEFAULT_REASON = 'The AI provider asked us to slow down'

export function createJobWaiter(queue: JobQueue): JobWaiter {
  let paused: RateLimitInfo | null = null
  const interrupts = new Set<(info: RateLimitInfo) => void>()

  // Lives as long as the queue: no unsubscribe needed.
  queue.onPause((until, reason) => {
    paused = until === null ? null : { resetAt: until.toISOString(), message: reason ?? DEFAULT_REASON }
    if (paused) for (const interrupt of [...interrupts]) interrupt(paused)
  })

  const limited = (info: RateLimitInfo): ServiceError =>
    new ServiceError('rate_limited', `${info.message}. Try again after the limit resets.`, info.resetAt)

  return {
    done(jobId) {
      return new Promise<JobInfo>((resolve, reject) => {
        const interrupt = (info: RateLimitInfo): void => {
          interrupts.delete(interrupt)
          reject(limited(info))
        }
        if (paused) {
          reject(limited(paused))
          return
        }
        interrupts.add(interrupt)
        queue.wait(jobId).then(
          (info) => {
            interrupts.delete(interrupt)
            if (info.state === 'done') resolve(info)
            else reject(jobFailure(info))
          },
          (err: unknown) => {
            interrupts.delete(interrupt)
            reject(err instanceof Error ? err : new Error(String(err)))
          }
        )
      })
    },
    rateLimit: () => paused
  }
}
