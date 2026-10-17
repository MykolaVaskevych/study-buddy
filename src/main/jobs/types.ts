import type { DocId, JobId, JobInfo, JobKind } from '@shared/domain'

/**
 * Persistent background job queue contract (owner: data work package).
 * - Jobs survive restarts (stored via JobRepo). Interrupted jobs are re-queued on start.
 * - Concurrency is global (settings.aiConcurrency); higher priority runs first.
 * - Handlers throw AiError(kind='rate_limited', resetAt) to pause ALL jobs until resetAt (job re-queued,
 *   attempt not counted). Retryable errors back off exponentially (max 4 attempts). Other errors fail the job.
 */

export interface JobSpec<P = unknown> {
  kind: JobKind
  docId: DocId | null
  payload: P
  /** Higher runs first. Default 0. Reader focus uses 100, prefetch 50, bulk indexing 0. */
  priority?: number
  /** If an unfinished job with this key exists, enqueue returns it instead of adding a duplicate. */
  dedupeKey?: string
  label: string
}

export interface JobContext {
  jobId: JobId
  signal: AbortSignal
  attempt: number
  progress(fraction: number, label?: string): void
}

export type JobHandler<P = unknown> = (payload: P, ctx: JobContext) => Promise<void>

export interface JobQueue {
  register<P>(kind: JobKind, handler: JobHandler<P>): void
  enqueue<P>(spec: JobSpec<P>): JobInfo
  /** Raise priority of an existing job (e.g. the chunk the reader just opened). */
  bump(jobId: JobId, priority: number): void
  cancel(jobId: JobId): void
  /** Resolves when the job reaches done/failed/cancelled. */
  wait(jobId: JobId): Promise<JobInfo>
  setConcurrency(n: number): void
  /** Pause all job starts until the given time (rate limit). null = resume now. */
  pauseUntil(until: Date | null): void
  onChange(listener: (job: JobInfo) => void): () => void
  onPause(listener: (until: Date | null, reason: string | null) => void): () => void
  start(): void
  stop(): Promise<void>
}
