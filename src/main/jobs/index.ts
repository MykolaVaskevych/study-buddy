import { AiError } from '@shared/ai/provider'
import type { JobId, JobInfo, JobKind, JobState } from '@shared/domain'
import type { JobRepo, JobRow } from '../db/types'
import type { JobContext, JobHandler, JobQueue, JobSpec } from './types'

export type * from './types'

/** Every JobKind, so jobs without a registered handler can be excluded instead of blocking the queue. */
const ALL_KINDS = [
  'index_chunk',
  'topic_map',
  'generate_cards',
  'generate_questions',
  'page_check',
  'verify_questions',
  'write_lesson'
] as const satisfies readonly JobKind[]
// Fails to compile if JobKind gains a member that is missing above.
const _allKindsListed: JobKind extends (typeof ALL_KINDS)[number] ? true : never = true

const TERMINAL: ReadonlySet<JobState> = new Set(['done', 'failed', 'cancelled'])
const RATE_LIMIT_BASE_MS = 60_000
const RATE_LIMIT_MAX_MS = 15 * 60_000

export interface JobQueueOptions {
  repo: JobRepo
  concurrency: number
  now?: () => Date
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
  /** Delay before retry n (1-based) is backoffMs[n - 1]; the last entry repeats. */
  backoffMs?: readonly number[]
  /** Total attempts including the first. */
  maxAttempts?: number
  /** Progress events of one job are at least this far apart unless progress moved >= 2 % or the label changed. */
  progressThrottleMs?: number
}

interface Running {
  controller: AbortController
  settled: Promise<void>
  /** Set by cancel(): the outcome of the handler is ignored. */
  cancelled: boolean
  /** Set by stop(): a failure puts the job back in the queue without counting the attempt. */
  shutdown: boolean
  label: string
  lastEmitAt: number
  lastProgress: number
  pending: { fraction: number; label: string | undefined } | null
  trailing: unknown
}

interface Waiter {
  resolve: (info: JobInfo) => void
  reject: (err: Error) => void
}

const toInfo = (row: JobRow): JobInfo => ({
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
})

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Persistent job queue. The repository is the source of truth for every job's state, so jobs survive
 * restarts; memory only holds what cannot be persisted: running handlers and their AbortControllers.
 *
 * Scheduling: `pump()` starts the best runnable job (priority desc, then age) while fewer than
 * `concurrency` handlers run and the queue is not paused. It is triggered by enqueue/register/bump/
 * finish, and by a single timer armed for the earliest of the pause end and the next backoff expiry.
 *
 * Failure policy:
 * - AiError('rate_limited'): the job is re-queued with its attempt NOT counted (the provider is busy,
 *   the job is fine) and ALL starts pause until `resetAt`, or 60 s doubling to 15 min when unknown.
 * - Retryable AiError or any non-AiError: exponential backoff via runAfter, at most `maxAttempts`.
 * - Other AiErrors: failed immediately.
 * Attempts are counted when a job starts, so a job that crashes the app repeatedly also runs out.
 */
export function createJobQueue(opts: JobQueueOptions): JobQueue {
  const { repo } = opts
  const now = opts.now ?? (() => new Date())
  const setTimer = opts.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>))
  const backoffMs = opts.backoffMs ?? [2_000, 8_000, 30_000]
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 4)
  const throttleMs = opts.progressThrottleMs ?? 100

  const handlers = new Map<JobKind, JobHandler<unknown>>()
  const running = new Map<JobId, Running>()
  const waiters = new Map<JobId, Waiter[]>()
  const changeListeners = new Set<(job: JobInfo) => void>()
  const pauseListeners = new Set<(until: Date | null, reason: string | null) => void>()

  let concurrency = clampConcurrency(opts.concurrency)
  let pausedUntil: Date | null = null
  let rateLimitStreak = 0
  let started = false
  let stopping = false
  let wakeTimer: unknown = null
  let pumpQueued = false

  const nowIso = (): string => now().toISOString()
  const excludedKinds = (): JobKind[] => ALL_KINDS.filter((k) => !handlers.has(k))

  function safeCall<A extends unknown[]>(fn: (...args: A) => void, ...args: A): void {
    try {
      fn(...args)
    } catch (err) {
      console.error('[jobs] listener failed', err)
    }
  }

  function emit(row: JobRow): void {
    const info = toInfo(row)
    for (const listener of changeListeners) safeCall(listener, info)
    if (TERMINAL.has(row.state)) {
      const list = waiters.get(row.id) ?? []
      waiters.delete(row.id)
      for (const w of list) w.resolve(info)
    }
  }

  function emitPause(until: Date | null, reason: string | null): void {
    for (const listener of pauseListeners) safeCall(listener, until, reason)
  }

  /** Persist + notify. Returns null when the job no longer exists (e.g. its document was deleted). */
  function update(id: JobId, patch: Parameters<JobRepo['update']>[1]): JobRow | null {
    if (!repo.get(id)) return null
    const row = repo.update(id, patch, nowIso())
    emit(row)
    return row
  }

  /** Coalesces triggers into one pump per microtask; never runs handlers re-entrantly inside a caller. */
  function schedulePump(): void {
    if (pumpQueued) return
    pumpQueued = true
    queueMicrotask(() => {
      pumpQueued = false
      pump()
    })
  }

  function pump(): void {
    if (!started || stopping) return
    if (pausedUntil) {
      if (now().getTime() < pausedUntil.getTime()) return armWake()
      pausedUntil = null
      emitPause(null, null)
    }
    while (running.size < concurrency) {
      const job = repo.nextRunnable(nowIso(), excludedKinds())
      if (!job || !startJob(job)) break
    }
    armWake()
  }

  function armWake(): void {
    if (wakeTimer !== null) clearTimer(wakeTimer)
    wakeTimer = null
    if (!started || stopping) return
    let at: number | null = pausedUntil?.getTime() ?? null
    if (at === null) {
      const next = repo.nextRunAfter(nowIso(), excludedKinds())
      at = next === null ? null : Date.parse(next)
    }
    if (at === null || Number.isNaN(at)) return
    wakeTimer = setTimer(
      () => {
        wakeTimer = null
        pump()
      },
      Math.max(0, at - now().getTime())
    )
  }

  /** Returns false if the job could not be considered (keeps pump() from spinning on it). */
  function startJob(job: JobRow): boolean {
    const handler = handlers.get(job.kind)
    if (!handler) return false
    if (job.attempts >= maxAttempts) {
      // Only reachable for jobs re-queued after a crash during their last attempt.
      update(job.id, { state: 'failed', error: job.error ?? `Interrupted ${job.attempts} times` })
      return true
    }
    const attempt = job.attempts + 1
    const entry: Running = {
      controller: new AbortController(),
      settled: Promise.resolve(),
      cancelled: false,
      shutdown: false,
      label: job.label,
      lastEmitAt: now().getTime(),
      lastProgress: job.progress,
      pending: null,
      trailing: null
    }
    running.set(job.id, entry)
    update(job.id, { state: 'running', attempts: attempt, runAfter: null })
    const ctx: JobContext = {
      jobId: job.id,
      signal: entry.controller.signal,
      attempt,
      progress: (fraction, label) => reportProgress(job.id, entry, fraction, label)
    }
    entry.settled = (async () => {
      let failure: { err: unknown } | null = null
      try {
        await handler(job.payload, ctx)
      } catch (err) {
        failure = { err }
      }
      settle(job.id, entry, attempt, failure)
    })()
    return true
  }

  function settle(id: JobId, entry: Running, attempt: number, failure: { err: unknown } | null): void {
    running.delete(id)
    if (entry.trailing !== null) clearTimer(entry.trailing)
    const current = repo.get(id)
    if (!current) {
      const list = waiters.get(id) ?? []
      waiters.delete(id)
      for (const w of list) w.reject(new Error(`Job ${id} was deleted`))
    } else if (!entry.cancelled && current.state !== 'cancelled') {
      finish(id, attempt, entry.shutdown, failure)
    }
    schedulePump()
  }

  function finish(id: JobId, attempt: number, shutdown: boolean, failure: { err: unknown } | null): void {
    if (failure === null) {
      rateLimitStreak = 0
      update(id, { state: 'done', progress: 1, error: null })
      return
    }
    const { err } = failure
    if (shutdown) {
      update(id, { state: 'queued', attempts: attempt - 1, runAfter: null })
    } else if (err instanceof AiError && err.kind === 'rate_limited') {
      update(id, { state: 'queued', attempts: attempt - 1, runAfter: null, error: null })
      pauseForRateLimit(err)
    } else if ((err instanceof AiError ? err.retryable : true) && attempt < maxAttempts) {
      const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] ?? 0
      const runAfter = new Date(now().getTime() + delay).toISOString()
      // The error stays visible on the queued job so the UI can say why it is waiting.
      update(id, { state: 'queued', error: messageOf(err), runAfter })
    } else {
      update(id, { state: 'failed', error: messageOf(err) })
    }
  }

  function pauseForRateLimit(err: AiError): void {
    const t = now().getTime()
    const reset = err.resetAt === null ? Number.NaN : Date.parse(err.resetAt)
    let until: number
    if (Number.isFinite(reset) && reset > t) {
      until = reset
    } else if (pausedUntil && pausedUntil.getTime() > t) {
      // Several in-flight jobs hit the same limit: that is one event, not a reason to double again.
      return
    } else {
      until = t + Math.min(RATE_LIMIT_BASE_MS * 2 ** rateLimitStreak, RATE_LIMIT_MAX_MS)
      rateLimitStreak++
    }
    if (pausedUntil && pausedUntil.getTime() >= until) return
    pausedUntil = new Date(until)
    emitPause(pausedUntil, err.message)
    armWake()
  }

  function reportProgress(id: JobId, entry: Running, fraction: number, label: string | undefined): void {
    if (entry.cancelled || running.get(id) !== entry || Number.isNaN(fraction)) return
    const f = Math.min(1, Math.max(0, fraction))
    const t = now().getTime()
    const labelChanged = label !== undefined && label !== entry.label
    if (labelChanged || Math.abs(f - entry.lastProgress) >= 0.02 || t - entry.lastEmitAt >= throttleMs) {
      flushProgress(id, entry, f, label)
      return
    }
    // Throttled: remember the latest value and flush it when the window ends, so it is never lost.
    entry.pending = { fraction: f, label }
    if (entry.trailing === null) {
      entry.trailing = setTimer(
        () => {
          entry.trailing = null
          const pending = entry.pending
          if (pending && running.get(id) === entry && !entry.cancelled) {
            flushProgress(id, entry, pending.fraction, pending.label)
          }
        },
        Math.max(0, throttleMs - (t - entry.lastEmitAt))
      )
    }
  }

  function flushProgress(id: JobId, entry: Running, fraction: number, label: string | undefined): void {
    if (entry.trailing !== null) clearTimer(entry.trailing)
    entry.trailing = null
    entry.pending = null
    entry.lastEmitAt = now().getTime()
    entry.lastProgress = fraction
    if (label !== undefined) entry.label = label
    update(id, { progress: fraction, ...(label !== undefined ? { label } : {}) })
  }

  return {
    register<P>(kind: JobKind, handler: JobHandler<P>) {
      // Payloads come back from JSON storage; the handler owns their shape (it enqueued them).
      handlers.set(kind, handler as JobHandler<unknown>)
      schedulePump()
    },

    enqueue<P>(spec: JobSpec<P>) {
      const priority = spec.priority ?? 0
      if (spec.dedupeKey !== undefined) {
        const existing = repo.findActive(spec.dedupeKey)
        if (existing) {
          // Same work requested again (e.g. the reader opened that chunk): keep one job, at the higher priority.
          if (priority <= existing.priority) return toInfo(existing)
          const raised = update(existing.id, { priority })
          schedulePump()
          return toInfo(raised ?? existing)
        }
      }
      const row = repo.insert(
        {
          kind: spec.kind,
          docId: spec.docId,
          payload: spec.payload,
          priority,
          dedupeKey: spec.dedupeKey ?? null,
          label: spec.label,
          runAfter: null
        },
        nowIso()
      )
      emit(row)
      schedulePump()
      return toInfo(row)
    },

    bump(jobId, priority) {
      const row = repo.get(jobId)
      if (!row || TERMINAL.has(row.state) || priority <= row.priority) return
      update(jobId, { priority })
      schedulePump()
    },

    cancel(jobId) {
      const row = repo.get(jobId)
      if (!row || TERMINAL.has(row.state)) return
      const entry = running.get(jobId)
      if (entry) {
        entry.cancelled = true
        if (entry.trailing !== null) clearTimer(entry.trailing)
        entry.controller.abort(new AiError('cancelled', 'Job cancelled'))
      }
      // The slot stays taken until the handler actually returns, so concurrency is never exceeded.
      update(jobId, { state: 'cancelled' })
      schedulePump()
    },

    wait(jobId) {
      const row = repo.get(jobId)
      if (!row) return Promise.reject(new Error(`Job not found: ${jobId}`))
      if (TERMINAL.has(row.state)) return Promise.resolve(toInfo(row))
      return new Promise<JobInfo>((resolve, reject) => {
        waiters.set(jobId, [...(waiters.get(jobId) ?? []), { resolve, reject }])
      })
    },

    setConcurrency(n) {
      concurrency = clampConcurrency(n)
      schedulePump()
    },

    pauseUntil(until) {
      if (until === null) {
        if (pausedUntil) {
          pausedUntil = null
          emitPause(null, null)
        }
        schedulePump()
        return
      }
      pausedUntil = until
      emitPause(until, null)
      armWake()
    },

    onChange(listener) {
      changeListeners.add(listener)
      return () => changeListeners.delete(listener)
    },

    onPause(listener) {
      pauseListeners.add(listener)
      return () => pauseListeners.delete(listener)
    },

    start() {
      if (started) return
      started = true
      stopping = false
      // Jobs left 'running' by a crash or kill; they keep the attempt they used.
      repo.requeueInterrupted(nowIso())
      schedulePump()
    },

    async stop() {
      if (!started) return
      stopping = true
      if (wakeTimer !== null) clearTimer(wakeTimer)
      wakeTimer = null
      const entries = [...running.values()]
      for (const entry of entries) {
        entry.shutdown = true
        entry.controller.abort(new AiError('cancelled', 'Study Buddy is shutting down'))
      }
      await Promise.allSettled(entries.map((e) => e.settled))
      started = false
      stopping = false
    }
  }
}

function clampConcurrency(n: number): number {
  return Number.isFinite(n) ? Math.max(1, Math.floor(n)) : 1
}
