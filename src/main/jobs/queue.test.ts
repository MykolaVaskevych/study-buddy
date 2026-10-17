import { openDatabase } from '@main/db'
import type { Database } from '@main/db'
import { AiError } from '@shared/ai/provider'
import type { JobInfo } from '@shared/domain'
import { createJobQueue, type JobContext, type JobQueueOptions } from './index'

/** Fake clock with manually fired timers: time only moves when the test says so. */
function manualTime(start = '2026-10-17T10:00:00.000Z') {
  let t = Date.parse(start)
  let seq = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  const flush = async () => {
    for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r))
  }
  return {
    now: () => new Date(t),
    setTimer: (fn: () => void, ms: number) => {
      timers.set(++seq, { at: t + ms, fn })
      return seq
    },
    clearTimer: (h: unknown) => {
      if (typeof h === 'number') timers.delete(h)
    },
    flush,
    /** Moves time forward, firing due timers in order (each followed by a flush). */
    async advance(ms: number) {
      const end = t + ms
      for (;;) {
        const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!next) break
        timers.delete(next[0])
        t = Math.max(t, next[1].at)
        next[1].fn()
        await flush()
      }
      t = end
      await flush()
    }
  }
}

/** Handler whose calls the test resolves/rejects explicitly. */
function controlledHandler() {
  const calls: {
    payload: unknown
    ctx: JobContext
    resolve: () => void
    reject: (err: unknown) => void
  }[] = []
  const handler = (payload: unknown, ctx: JobContext) =>
    new Promise<void>((resolve, reject) => calls.push({ payload, ctx, resolve, reject }))
  return { calls, handler }
}

function setup(overrides: Partial<JobQueueOptions> = {}, db: Database = openDatabase(':memory:')) {
  const time = manualTime()
  const queue = createJobQueue({
    repo: db.jobs,
    concurrency: 2,
    now: time.now,
    setTimer: time.setTimer,
    clearTimer: time.clearTimer,
    ...overrides
  })
  const events: JobInfo[] = []
  const pauses: [Date | null, string | null][] = []
  queue.onChange((j) => events.push(j))
  queue.onPause((until, reason) => pauses.push([until, reason]))
  return { db, time, queue, events, pauses }
}

const spec = (label: string, extra: { priority?: number; dedupeKey?: string } = {}) => ({
  kind: 'index_chunk' as const,
  docId: null,
  payload: { label },
  label,
  ...extra
})

describe('createJobQueue', () => {
  it('runs at most `concurrency` jobs and starts the next when one finishes', async () => {
    const { db, time, queue } = setup()
    const h = controlledHandler()
    queue.register('index_chunk', h.handler)
    queue.start()
    const [a, b, c] = ['a', 'b', 'c'].map((l) => queue.enqueue(spec(l)))
    await time.flush()
    expect(h.calls.map((x) => x.payload)).toEqual([{ label: 'a' }, { label: 'b' }])
    expect(db.jobs.get(c!.id)?.state).toBe('queued')

    h.calls[0]!.resolve()
    await time.flush()
    expect(db.jobs.get(a!.id)).toMatchObject({ state: 'done', progress: 1, attempts: 1 })
    expect(h.calls).toHaveLength(3)

    queue.setConcurrency(5)
    queue.enqueue(spec('d'))
    await time.flush()
    expect(h.calls).toHaveLength(4)
    expect(b).toBeTruthy()
  })

  it('starts higher priority first, then oldest; bump reorders', async () => {
    const { time, queue } = setup({ concurrency: 1 })
    const h = controlledHandler()
    queue.register('index_chunk', h.handler)
    queue.enqueue(spec('bulk-1'))
    queue.enqueue(spec('bulk-2'))
    queue.enqueue(spec('prefetch', { priority: 50 }))
    const late = queue.enqueue(spec('late'))
    queue.enqueue(spec('focus', { priority: 100 }))
    queue.bump(late.id, 75)
    queue.start()
    const order: unknown[] = []
    for (let i = 0; i < 5; i++) {
      await time.flush()
      order.push(h.calls.at(-1)?.payload)
      h.calls.at(-1)?.resolve()
    }
    expect(order.map((p) => (p as { label: string }).label)).toEqual([
      'focus',
      'late',
      'prefetch',
      'bulk-1',
      'bulk-2'
    ])
  })

  it('dedupeKey returns the unfinished job (raising its priority) and allows a new one once finished', async () => {
    const { time, queue, db } = setup({ concurrency: 1 })
    const h = controlledHandler()
    queue.register('index_chunk', h.handler)
    const first = queue.enqueue(spec('chunk 3', { dedupeKey: 'idx:3' }))
    const again = queue.enqueue(spec('chunk 3', { dedupeKey: 'idx:3', priority: 100 }))
    expect(again.id).toBe(first.id)
    expect(db.jobs.get(first.id)?.priority).toBe(100)
    expect(db.jobs.list(null, 10)).toHaveLength(1)

    queue.start()
    await time.flush()
    expect(queue.enqueue(spec('chunk 3', { dedupeKey: 'idx:3' })).id).toBe(first.id) // still running
    h.calls[0]!.resolve()
    await expect(queue.wait(first.id)).resolves.toMatchObject({ state: 'done' })
    expect(queue.enqueue(spec('chunk 3', { dedupeKey: 'idx:3' })).id).not.toBe(first.id)
  })

  it('retries retryable errors with 2 s / 8 s / 30 s backoff, then fails after 4 attempts', async () => {
    const { time, queue, db } = setup()
    const attempts: number[] = []
    queue.register('index_chunk', async (_p, ctx) => {
      attempts.push(ctx.attempt)
      throw new AiError('network', `socket hang up #${ctx.attempt}`)
    })
    queue.start()
    const job = queue.enqueue(spec('flaky'))
    const done = queue.wait(job.id)
    await time.flush()
    expect(attempts).toEqual([1])
    expect(db.jobs.get(job.id)).toMatchObject({
      state: 'queued',
      attempts: 1,
      error: 'socket hang up #1',
      runAfter: '2026-10-17T10:00:02.000Z'
    })

    await time.advance(1_999)
    expect(attempts).toEqual([1])
    await time.advance(1)
    expect(attempts).toEqual([1, 2])
    await time.advance(8_000)
    expect(attempts).toEqual([1, 2, 3])
    await time.advance(29_999)
    expect(attempts).toEqual([1, 2, 3])
    await time.advance(1)
    expect(attempts).toEqual([1, 2, 3, 4])
    await expect(done).resolves.toMatchObject({ state: 'failed', attempts: 4, error: 'socket hang up #4' })
    await time.advance(60_000)
    expect(attempts).toHaveLength(4)
  })

  it('fails non-retryable AiErrors immediately; retries unknown errors', async () => {
    const { time, queue, db } = setup()
    queue.register('topic_map', async () => {
      throw new AiError('auth', 'Not logged in to Claude Code')
    })
    queue.register('index_chunk', async () => {
      throw new TypeError('boom')
    })
    queue.start()
    const auth = queue.enqueue({ ...spec('auth'), kind: 'topic_map' })
    const unknown = queue.enqueue(spec('unknown'))
    await time.flush()
    expect(db.jobs.get(auth.id)).toMatchObject({
      state: 'failed',
      attempts: 1,
      error: 'Not logged in to Claude Code'
    })
    expect(db.jobs.get(unknown.id)).toMatchObject({ state: 'queued', attempts: 1, error: 'boom' })
  })

  it('a rate limit pauses every start until resetAt and re-queues the job without counting the attempt', async () => {
    const { time, queue, db, pauses } = setup({ concurrency: 1 })
    let limited = true
    const seen: number[] = []
    queue.register('index_chunk', async (_p, ctx) => {
      seen.push(ctx.attempt)
      if (limited)
        throw new AiError('rate_limited', 'Usage limit reached', { resetAt: '2026-10-17T10:05:00.000Z' })
    })
    queue.start()
    const job = queue.enqueue(spec('a'))
    const other = queue.enqueue(spec('b'))
    await time.flush()
    expect(db.jobs.get(job.id)).toMatchObject({ state: 'queued', attempts: 0, error: null })
    expect(pauses).toEqual([[new Date('2026-10-17T10:05:00.000Z'), 'Usage limit reached']])

    queue.enqueue(spec('c'))
    await time.advance(4 * 60_000)
    expect(seen).toEqual([1])
    expect(db.jobs.get(other.id)?.state).toBe('queued')

    limited = false
    await time.advance(60_000)
    expect(pauses.at(-1)).toEqual([null, null])
    expect(seen).toEqual([1, 1, 1, 1])
    expect(db.jobs.get(job.id)).toMatchObject({ state: 'done', attempts: 1 })
  })

  it('without resetAt the pause is 60 s, doubling per consecutive limit up to 15 min', async () => {
    const { time, queue, pauses } = setup({ concurrency: 1 })
    let failures = 7
    queue.register('index_chunk', async () => {
      if (failures-- > 0) throw new AiError('rate_limited', 'slow down')
    })
    queue.start()
    const job = queue.enqueue(spec('a'))
    await time.flush()
    const lengths: number[] = []
    let last = time.now().getTime()
    for (let i = 0; i < 7; i++) {
      const until = pauses.filter(([u]) => u !== null).at(-1)?.[0]
      lengths.push((until!.getTime() - last) / 60_000)
      await time.advance(until!.getTime() - time.now().getTime())
      last = time.now().getTime()
    }
    expect(lengths).toEqual([1, 2, 4, 8, 15, 15, 15])
    await expect(queue.wait(job.id)).resolves.toMatchObject({ state: 'done', attempts: 1 })
  })

  it('cancel aborts a running job and drops a queued one; wait() resolves cancelled', async () => {
    const { time, queue, db } = setup({ concurrency: 1 })
    const h = controlledHandler()
    queue.register('index_chunk', h.handler)
    queue.start()
    const running = queue.enqueue(spec('running'))
    const queued = queue.enqueue(spec('queued'))
    await time.flush()
    const waiting = queue.wait(running.id)

    queue.cancel(running.id)
    expect(h.calls[0]!.ctx.signal.aborted).toBe(true)
    await expect(waiting).resolves.toMatchObject({ state: 'cancelled' })
    queue.cancel(queued.id)
    expect(db.jobs.get(queued.id)?.state).toBe('cancelled')

    // The cancelled handler finishing later does not resurrect it, and the queued one never runs.
    h.calls[0]!.resolve()
    await time.flush()
    expect(db.jobs.get(running.id)?.state).toBe('cancelled')
    expect(h.calls).toHaveLength(1)
  })

  it('start() re-queues jobs a crash left running, and gives up on jobs that keep crashing', async () => {
    const db = openDatabase(':memory:')
    const now = '2026-10-17T09:00:00.000Z'
    const crashed = db.jobs.insert(
      {
        kind: 'index_chunk',
        docId: null,
        payload: { n: 1 },
        priority: 0,
        dedupeKey: null,
        label: 'x',
        runAfter: null
      },
      now
    )
    db.jobs.update(crashed.id, { state: 'running', attempts: 1, progress: 0.4 }, now)
    const looping = db.jobs.insert(
      {
        kind: 'index_chunk',
        docId: null,
        payload: { n: 2 },
        priority: 0,
        dedupeKey: null,
        label: 'y',
        runAfter: null
      },
      now
    )
    db.jobs.update(looping.id, { state: 'running', attempts: 4 }, now)

    const { time, queue } = setup({}, db)
    const seen: [unknown, number][] = []
    queue.register('index_chunk', async (payload, ctx) => {
      seen.push([payload, ctx.attempt])
    })
    queue.start()
    await time.flush()
    expect(seen).toEqual([[{ n: 1 }, 2]])
    expect(db.jobs.get(crashed.id)?.state).toBe('done')
    expect(db.jobs.get(looping.id)).toMatchObject({ state: 'failed', error: 'Interrupted 4 times' })
  })

  it('backoff survives a restart: the new queue wakes up at the persisted runAfter', async () => {
    const db = openDatabase(':memory:')
    const job = db.jobs.insert(
      {
        kind: 'index_chunk',
        docId: null,
        payload: null,
        priority: 0,
        dedupeKey: null,
        label: 'x',
        runAfter: '2026-10-17T10:00:30.000Z'
      },
      '2026-10-17T09:59:00.000Z'
    )
    const { time, queue } = setup({}, db)
    const ran: string[] = []
    queue.register('index_chunk', async (_p, ctx) => {
      ran.push(ctx.jobId)
    })
    queue.start()
    await time.advance(29_000)
    expect(ran).toEqual([])
    await time.advance(1_000)
    expect(ran).toEqual([job.id])
  })

  it('jobs of a kind without a handler wait without blocking other kinds', async () => {
    const { time, queue, db } = setup({ concurrency: 1 })
    queue.start()
    const orphan = queue.enqueue({ ...spec('topics'), kind: 'topic_map', priority: 100 })
    const ran: string[] = []
    queue.register('index_chunk', async (_p, ctx) => {
      ran.push(ctx.jobId)
    })
    const job = queue.enqueue(spec('index'))
    await time.flush()
    expect(ran).toEqual([job.id])
    expect(db.jobs.get(orphan.id)?.state).toBe('queued')
    queue.register('topic_map', async () => {})
    await time.flush()
    expect(db.jobs.get(orphan.id)?.state).toBe('done')
  })

  it('emits change events for state changes and throttles progress (trailing value never lost)', async () => {
    const { time, queue, events } = setup()
    const h = controlledHandler()
    queue.register('index_chunk', h.handler)
    queue.start()
    const job = queue.enqueue(spec('p'))
    await time.flush()
    const ctx = h.calls[0]!.ctx
    const progressEvents = () =>
      events.filter((e) => e.id === job.id && e.state === 'running').map((e) => e.progress)

    for (let i = 1; i <= 10; i++) ctx.progress(i / 1000) // tiny steps inside one throttle window
    expect(progressEvents()).toEqual([0])
    await time.advance(100)
    expect(progressEvents()).toEqual([0, 0.01])

    ctx.progress(0.5) // a big jump is reported immediately
    ctx.progress(0.5, 'Pages 11-20') // so is a label change
    expect(progressEvents()).toEqual([0, 0.01, 0.5, 0.5])
    expect(events.at(-1)?.label).toBe('Pages 11-20')

    h.calls[0]!.resolve()
    await time.flush()
    expect(events.filter((e) => e.id === job.id).map((e) => e.state)).toEqual([
      'queued',
      'running',
      'running',
      'running',
      'running',
      'done'
    ])
  })

  it('stop() aborts running handlers and re-queues them without counting the attempt', async () => {
    const { time, queue, db } = setup()
    queue.register('index_chunk', (_p, ctx) => {
      return new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener('abort', () => reject(ctx.signal.reason))
      })
    })
    queue.start()
    const job = queue.enqueue(spec('long'))
    await time.flush()
    expect(db.jobs.get(job.id)).toMatchObject({ state: 'running', attempts: 1 })
    await queue.stop()
    expect(db.jobs.get(job.id)).toMatchObject({ state: 'queued', attempts: 0 })
  })

  it('manual pauseUntil holds starts; null resumes', async () => {
    const { time, queue, pauses } = setup()
    const ran: string[] = []
    queue.register('index_chunk', async (_p, ctx) => {
      ran.push(ctx.jobId)
    })
    queue.start()
    queue.pauseUntil(new Date('2026-10-17T11:00:00.000Z'))
    queue.enqueue(spec('a'))
    await time.advance(60_000)
    expect(ran).toHaveLength(0)
    queue.pauseUntil(null)
    await time.flush()
    expect(ran).toHaveLength(1)
    expect(pauses).toEqual([
      [new Date('2026-10-17T11:00:00.000Z'), null],
      [null, null]
    ])
  })

  it('wait() rejects for unknown jobs and resolves at once for finished ones', async () => {
    const { time, queue } = setup()
    queue.register('index_chunk', async () => {})
    queue.start()
    await expect(queue.wait('nope')).rejects.toThrow(/not found/)
    const job = queue.enqueue(spec('a'))
    await time.flush()
    await expect(queue.wait(job.id)).resolves.toMatchObject({ state: 'done' })
  })
})
