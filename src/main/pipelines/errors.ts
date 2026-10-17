import { AiError } from '@shared/ai/provider'
import type { JobInfo } from '@shared/domain'
import { LibraryError } from '../library/types'
import { ServiceError } from './types'

/**
 * Error translation. Modules throw their own typed errors (AiError, LibraryError, the db's
 * NotFoundError); the IPC layer only understands ServiceError, so every handler is wrapped with
 * `toServiceError`. Job handlers keep AiError instead, because that is what the queue's retry
 * policy reads.
 */

/** Maps an expected failure to a ServiceError; anything unknown is returned unchanged (= 'internal'). */
export function toServiceError(err: unknown): unknown {
  if (err instanceof ServiceError) return err
  if (err instanceof AiError) {
    if (err.kind === 'rate_limited') return new ServiceError('rate_limited', err.message, err.resetAt)
    return new ServiceError('ai', err.message)
  }
  if (err instanceof LibraryError) {
    // Disk errors are ours, not the user's file's fault.
    return err.kind === 'io' ? err : new ServiceError('validation', err.message)
  }
  // The db's NotFoundError is matched by name: importing the db module here would pull the SQLite
  // driver into this layer for an instanceof check.
  if (err instanceof Error && err.name === 'NotFoundError') return new ServiceError('not_found', err.message)
  return err
}

/**
 * A job failure that retrying cannot fix (deleted scope, exhausted budget, nothing to work on).
 * The queue retries every non-AiError and every retryable AiError, so this is the way to fail at once.
 */
export function fatal(message: string): AiError {
  return new AiError('unknown', message, { retryable: false })
}

export function notFound(what: string, id: string): ServiceError {
  return new ServiceError('not_found', `${what} not found: ${id}`)
}

/** Error for a request whose job ended without success. */
export function jobFailure(job: JobInfo): ServiceError {
  if (job.state === 'cancelled') return new ServiceError('conflict', `"${job.label}" was cancelled`)
  return new ServiceError('ai', job.error ?? `"${job.label}" failed`)
}

export function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
