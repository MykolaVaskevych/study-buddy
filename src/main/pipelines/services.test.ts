import { AiError } from '@shared/ai/provider'
import type { JobInfo } from '@shared/domain'
import { openTestDb } from '../db/test-helpers'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { createStudyAi } from '../ai/study-ai'
import { LibraryError } from '../library/types'
import { localDate } from './dates'
import { fatal, jobFailure, toServiceError } from './errors'
import { readingSpeedFactor, toNewTopic } from './topics'
import { ServiceError } from './types'
import { createUsageLedger } from './usage'

describe('readingSpeedFactor', () => {
  it('scales the 90 s/page baseline, clamped to 0.5×–2×, 1 without data', () => {
    expect(readingSpeedFactor(null)).toBe(1)
    expect(readingSpeedFactor(90)).toBe(1)
    expect(readingSpeedFactor(135)).toBe(1.5)
    expect(readingSpeedFactor(600)).toBe(2)
    expect(readingSpeedFactor(10)).toBe(0.5)
    expect(readingSpeedFactor(Number.NaN)).toBe(1)
  })
})

describe('toNewTopic', () => {
  it('calibrates minutes, keeps full >= core and passes prerequisite keys through', () => {
    const topic = toNewTopic(
      {
        key: 'k',
        parentKey: null,
        title: 'T',
        pageStart: 1,
        pageEnd: 4,
        objectives: ['o'],
        difficulty: 3,
        examWeight: 0.4,
        examWeightReasons: ['r'],
        coreFraction: 0.6,
        coreMinutes: 30,
        fullMinutes: 20,
        prerequisiteKeys: ['p']
      },
      1.5
    )
    expect(topic.estimates).toMatchObject({
      coreMinutes: 45,
      fullMinutes: 45,
      prerequisites: ['p'],
      examWeight: 0.4
    })
  })
})

describe('toServiceError', () => {
  it('maps module errors to the IPC kinds', () => {
    const limited = toServiceError(
      new AiError('rate_limited', 'slow down', { resetAt: '2026-10-17T11:00:00.000Z' })
    )
    expect(limited).toEqual(new ServiceError('rate_limited', 'slow down', '2026-10-17T11:00:00.000Z'))
    expect(toServiceError(new AiError('auth', 'no key'))).toMatchObject({ kind: 'ai', message: 'no key' })
    expect(toServiceError(new LibraryError('not_pdf', 'x.txt is not a PDF'))).toMatchObject({
      kind: 'validation'
    })
    const io = new LibraryError('io', 'disk full')
    expect(toServiceError(io)).toBe(io)
    const missing = new Error('Card not found: c1')
    missing.name = 'NotFoundError'
    expect(toServiceError(missing)).toMatchObject({ kind: 'not_found' })
    const bug = new TypeError('boom')
    expect(toServiceError(bug)).toBe(bug)
  })

  it('fatal() is never retried and job failures explain themselves', () => {
    expect(fatal('nope').retryable).toBe(false)
    const job = { label: 'Page check for p. 2', error: null } as JobInfo
    expect(jobFailure({ ...job, state: 'cancelled' })).toMatchObject({ kind: 'conflict' })
    expect(jobFailure({ ...job, state: 'failed', error: 'model refused' })).toMatchObject({
      kind: 'ai',
      message: 'model refused'
    })
  })
})

describe('usage ledger', () => {
  const usage = (costUsd: number, notional: boolean) => ({
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd,
    notional
  })

  it('records every usage record with the provider and checks the budget only for anthropic-api', async () => {
    const { db, clock } = openTestDb()
    const ai = createStudyAi(createFakeProvider())
    const ledger = createUsageLedger({ db, aiFor: () => ai, now: clock.now })

    const value = await ledger.run(null, async () => ({
      value: 42,
      usage: [
        { task: 'questions', model: 'm', usage: usage(0.5, false) },
        { task: 'verify', model: 'm', usage: usage(0.25, false) }
      ]
    }))
    expect(value).toBe(42)
    const summary = db.usage.summary(clock.now().toISOString())
    expect(summary.byTask.map((t) => [t.task, t.calls])).toEqual([
      ['questions', 1],
      ['verify', 1]
    ])

    db.settings.update({ monthlyBudgetUsd: 0.5 })
    // The fake provider's records were stored as provider 'fake'; billed spend is what counts.
    expect(() => ledger.assertBudget('anthropic-api')).toThrow(
      /Monthly AI budget reached: \$0\.75 of \$0\.50/
    )
    expect(() => ledger.assertBudget('claude-code')).not.toThrow()
    db.settings.update({ monthlyBudgetUsd: null })
    expect(() => ledger.assertBudget('anthropic-api')).not.toThrow()
  })
})

describe('localDate', () => {
  it('formats the local calendar day', () => {
    expect(localDate(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(localDate(new Date(2026, 11, 31, 0, 1))).toBe('2026-12-31')
  })
})
