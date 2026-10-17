import { DEFAULT_SETTINGS } from '@shared/settings'
import type { Usage } from '@shared/ai/provider'
import type { JobRow } from '../types'
import { openTestDb, seedDocument } from '../test-helpers'
import { resolveSettings } from './settings'

const usage = (costUsd: number | null, notional: boolean): Usage => ({
  inputTokens: 100,
  outputTokens: 50,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd,
  notional
})

describe('ReadingRepo', () => {
  it('accumulates seconds per page and averages only real reading', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const now = '2026-10-17T10:00:00.000Z'
    db.reading.track(doc, 1, 30, now)
    db.reading.track(doc, 1, 30, now)
    db.reading.track(doc, 2, 2, now) // a flip, ignored
    db.reading.track(doc, 3, -5, now) // invalid, ignored
    expect(db.reading.secondsOnPage(doc, 1)).toBe(60)
    expect(db.reading.secondsOnPage(doc, 9)).toBe(0)
    expect(db.reading.averageSecondsPerPage(doc)).toBeNull() // too little data

    db.reading.track(doc, 4, 90, now)
    db.reading.track(doc, 5, 3 * 3600, now) // left open: capped at 15 min
    expect(db.reading.averageSecondsPerPage(doc)).toBeCloseTo((60 + 90 + 900) / 3, 10)
  })
})

describe('PlanRepo', () => {
  it('saves one plan per document, keeping id and createdAt on re-save', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const plan = {
      docId: doc,
      input: {
        examDate: null,
        totalHours: 5,
        hoursPerDay: null,
        targetScore: 0.6,
        mode: 'min_time' as const,
        format: 'mcq' as const,
        overrides: [{ topicId: 't1', level: 'skip' as const }]
      },
      result: {
        feasible: false,
        expectedScore: 0.5,
        targetScore: 0.6,
        budgetMinutes: 300,
        plannedMinutes: 300,
        items: [],
        notes: ['Target not reachable']
      },
      schedule: { days: [] }
    }
    expect(db.plans.get(doc)).toBeNull()
    const first = db.plans.save(plan, '2026-10-17T10:00:00.000Z')
    const second = db.plans.save(
      { ...plan, input: { ...plan.input, totalHours: 8 } },
      '2026-10-18T10:00:00.000Z'
    )
    expect(second).toMatchObject({
      id: first.id,
      createdAt: '2026-10-17T10:00:00.000Z',
      updatedAt: '2026-10-18T10:00:00.000Z'
    })
    expect(db.plans.get(doc)?.input.totalHours).toBe(8)
    expect(db.plans.get(doc)?.input.overrides).toEqual([{ topicId: 't1', level: 'skip' }])
  })
})

describe('UsageRepo', () => {
  // Local-time constructors keep the test independent of the machine's time zone.
  const at = (day: number, hour: number, minute = 0) => new Date(2026, 9, day, hour, minute).toISOString()

  it('sums today and this month by LOCAL date, grouped by task', () => {
    const { db } = openTestDb()
    const record = (task: 'index' | 'cards', cost: number | null, when: string, notional = true) =>
      db.usage.record(
        { task, model: 'haiku', provider: 'claude-code', docId: null, usage: usage(cost, notional) },
        when
      )
    record('index', 1, at(16, 23, 30)) // yesterday, local
    record('index', 2, at(17, 0, 30)) // today, local
    record('cards', 4, at(17, 12))
    record('cards', null, at(17, 13)) // unknown cost counts as a call with 0 USD
    record('index', 8, new Date(2026, 8, 30, 23, 59).toISOString()) // last month

    expect(db.usage.summary(at(17, 18))).toEqual({
      notional: true,
      todayUsd: 6,
      monthUsd: 7,
      byTask: [
        { task: 'cards', usd: 4, calls: 2 },
        { task: 'index', usd: 3, calls: 2 }
      ]
    })
    expect(db.usage.monthSpendUsd(at(17, 18))).toBe(0)
  })

  it('is not notional once a billed entry exists; the budget counts billed spend only', () => {
    const { db } = openTestDb()
    db.usage.record(
      { task: 'index', model: 'm', provider: 'claude-code', docId: null, usage: usage(5, true) },
      at(3, 9)
    )
    db.usage.record(
      { task: 'grade', model: 'm', provider: 'anthropic-api', docId: null, usage: usage(0.25, false) },
      at(4, 9)
    )
    const summary = db.usage.summary(at(17, 9))
    expect(summary.notional).toBe(false)
    expect(summary.monthUsd).toBeCloseTo(5.25, 10)
    expect(summary.todayUsd).toBe(0)
    expect(db.usage.monthSpendUsd(at(17, 9))).toBeCloseTo(0.25, 10)
  })

  it('an empty month is notional with zero totals', () => {
    const { db } = openTestDb()
    expect(db.usage.summary(at(17, 9))).toEqual({ notional: true, todayUsd: 0, monthUsd: 0, byTask: [] })
  })
})

describe('SettingsRepo', () => {
  it('returns defaults, merges updates (nested models key by key) and validates', () => {
    const { db } = openTestDb()
    expect(db.settings.get()).toEqual(DEFAULT_SETTINGS)
    const updated = db.settings.update({ aiConcurrency: 2, monthlyBudgetUsd: 10 })
    expect(updated).toEqual({ ...DEFAULT_SETTINGS, aiConcurrency: 2, monthlyBudgetUsd: 10 })
    expect(db.settings.update({ theme: 'dark' })).toMatchObject({ aiConcurrency: 2, theme: 'dark' })
    expect(() => db.settings.update({ aiConcurrency: 99 })).toThrow()
    expect(db.settings.get().aiConcurrency).toBe(2)
  })

  it('resolveSettings falls back per key when a stored value is invalid or obsolete', () => {
    const resolved = resolveSettings({
      aiConcurrency: 'lots',
      theme: 'dark',
      models: { 'claude-code': { fast: 'sonnet' } },
      removedSetting: true
    })
    expect(resolved).toEqual({
      ...DEFAULT_SETTINGS,
      theme: 'dark',
      models: { ...DEFAULT_SETTINGS.models, 'claude-code': { fast: 'sonnet', smart: 'opus' } }
    })
  })

  it('stores, replaces and removes secret blobs', () => {
    const { db } = openTestDb()
    expect(db.settings.getSecret('apiKey')).toBeNull()
    db.settings.setSecret('apiKey', Buffer.from([1, 2, 3]))
    db.settings.setSecret('apiKey', Buffer.from([4, 5]))
    expect(db.settings.getSecret('apiKey')).toEqual(Buffer.from([4, 5]))
    db.settings.setSecret('apiKey', null)
    expect(db.settings.getSecret('apiKey')).toBeNull()
  })
})

describe('JobRepo', () => {
  const spec = (
    overrides: Partial<Parameters<ReturnType<typeof openTestDb>['db']['jobs']['insert']>[0]> = {}
  ) => ({
    kind: 'index_chunk' as const,
    docId: null,
    payload: { chunk: 1 },
    priority: 0,
    dedupeKey: null,
    label: 'Index',
    runAfter: null,
    ...overrides
  })

  it('inserts queued jobs and finds active ones by dedupe key', () => {
    const { db } = openTestDb()
    const now = '2026-10-17T10:00:00.000Z'
    const job = db.jobs.insert(spec({ dedupeKey: 'idx:1' }), now)
    expect(job).toMatchObject<Partial<JobRow>>({
      state: 'queued',
      progress: 0,
      attempts: 0,
      error: null,
      payload: { chunk: 1 },
      createdAt: now,
      updatedAt: now
    })
    expect(db.jobs.findActive('idx:1')?.id).toBe(job.id)
    db.jobs.update(job.id, { state: 'done' }, now)
    expect(db.jobs.findActive('idx:1')).toBeNull()
    expect(() => db.jobs.update('missing', { state: 'done' }, now)).toThrow(/not found/)
  })

  it('nextRunnable: priority desc, then createdAt asc, skipping backoff and excluded kinds', () => {
    const { db } = openTestDb()
    const t0 = '2026-10-17T10:00:00.000Z'
    const low = db.jobs.insert(spec({ label: 'low' }), t0)
    const highLater = db.jobs.insert(spec({ label: 'high-later', priority: 50 }), '2026-10-17T10:00:01.000Z')
    const highFirst = db.jobs.insert(spec({ label: 'high-first', priority: 50 }), t0)
    const backoff = db.jobs.insert(
      spec({ label: 'backoff', priority: 100, runAfter: '2026-10-17T10:05:00.000Z' }),
      t0
    )
    const topic = db.jobs.insert(spec({ kind: 'topic_map', label: 'topic', priority: 90 }), t0)

    const now = '2026-10-17T10:01:00.000Z'
    expect(db.jobs.nextRunnable(now)?.id).toBe(topic.id)
    expect(db.jobs.nextRunnable(now, ['topic_map'])?.id).toBe(highFirst.id)
    expect(db.jobs.nextRunnable('2026-10-17T10:05:00.000Z')?.id).toBe(backoff.id)
    expect(db.jobs.nextRunAfter(now)).toBe('2026-10-17T10:05:00.000Z')
    expect(db.jobs.nextRunAfter(now, ['index_chunk'])).toBeNull()

    db.jobs.update(topic.id, { state: 'running' }, now)
    db.jobs.update(highFirst.id, { state: 'running' }, now)
    expect(db.jobs.nextRunnable(now)?.id).toBe(highLater.id)
    expect(db.jobs.requeueInterrupted(now)).toBe(2)
    expect(db.jobs.get(topic.id)?.state).toBe('queued')

    db.jobs.update(low.id, { state: 'failed', error: 'nope' }, '2026-10-17T10:02:00.000Z')
    db.jobs.update(highLater.id, { state: 'running', progress: 0.5 }, now)
    const listed = db.jobs.list(null, 10)
    expect(listed.map((j) => j.label)).toEqual(['high-later', 'backoff', 'topic', 'high-first', 'low'])
    expect(listed[0]).not.toHaveProperty('payload')
    expect(db.jobs.list(null, 2)).toHaveLength(2)
  })

  it('normalises runAfter and filters list by document', () => {
    const { db } = openTestDb()
    const doc = seedDocument(db)
    const job = db.jobs.insert(spec({ docId: doc }), '2026-10-17T10:00:00.000Z')
    db.jobs.insert(spec(), '2026-10-17T10:00:00.000Z')
    const updated = db.jobs.update(
      job.id,
      { runAfter: '2026-10-17T12:00:00+02:00', attempts: 1 },
      '2026-10-17T10:00:01.000Z'
    )
    expect(updated.runAfter).toBe('2026-10-17T10:00:00.000Z')
    expect(db.jobs.list(doc, 10).map((j) => j.id)).toEqual([job.id])
  })
})
