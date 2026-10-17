import { stat } from 'node:fs/promises'
import { AiError, type LlmProvider } from '@shared/ai/provider'
import type { RateLimitInfo } from '@shared/domain'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { readPdfPages } from '../library/test-pdfs'
import { NOTHING_TO_TEST } from './page-checks'
import { PRIORITY } from './priorities'
import {
  correctResponse,
  createHarness,
  recordingProvider,
  wrongResponse,
  type Harness
} from './test-harness'
import { ServiceError } from './types'

let t: Harness
afterEach(async () => {
  await t.close()
})

const HOUR = 60 * 60 * 1000

/** Provider whose calls hang until their signal aborts; records the signals. */
function hangingProvider(): LlmProvider & { signals: AbortSignal[] } {
  const fake = createFakeProvider()
  const signals: AbortSignal[] = []
  return {
    ...fake,
    signals,
    generate: (req) =>
      new Promise((_resolve, reject) => {
        if (req.signal) signals.push(req.signal)
        req.signal?.addEventListener('abort', () => reject(new AiError('cancelled', 'aborted')))
      })
  }
}

async function until(check: () => boolean, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!check()) {
    if (Date.now() > deadline) throw new Error('condition not met in time')
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

const stampsOf = async (path: string): Promise<number[]> =>
  (await readPdfPages(path)).map((p) => Number(/SB-PAGE (\d+)/.exec(p.text)?.[1] ?? 0))

describe('token efficiency', () => {
  it('page checks and small scopes send a focus chunk (pages ± 1), the index pass whole chunks', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()

    const indexParts = rec.calls.filter((c) => c.task === 'index').flatMap((c) => c.parts)
    expect(indexParts.filter((p) => p.type === 'pdf').map((p) => (p.type === 'pdf' ? p.title : ''))).toEqual(
      expect.arrayContaining(['Pages 1-10', 'Pages 11-12'])
    )

    await t.h['quiz.pageCheck']({ docId, page: 2 })
    const check = rec.calls.find((c) => c.task === 'page_check')
    const pdfs = check?.parts.filter((p) => p.type === 'pdf') ?? []
    expect(pdfs).toHaveLength(1)
    const path = pdfs[0]?.type === 'pdf' ? pdfs[0].path : ''
    expect(path).toMatch(/\/focus\/1-3\.pdf$/)
    expect(await stampsOf(path)).toEqual([1, 2, 3])
    expect(check?.focus).toEqual({ from: 2, to: 2 })
    // The blind verification pass re-sends the same small file (prompt-cache friendly).
    const verify = rec.calls.find((c) => c.task === 'verify')
    expect(verify?.parts.find((p) => p.type === 'pdf')).toEqual(pdfs[0])

    const [topic] = await t.h['topics.list']({ docId })
    const { jobId } = await t.h['cards.generate']({
      scope: { kind: 'topic', docId, topicId: topic?.id ?? '' },
      essentialsOnly: true,
      count: 3
    })
    await t.queue.wait(jobId)
    const cardCall = rec.calls.find((c) => c.task === 'cards')
    const cardPdf = cardCall?.parts.find((p) => p.type === 'pdf')
    expect(cardPdf?.type === 'pdf' ? cardPdf.path : '').toMatch(/\/focus\/1-6\.pdf$/)
  })

  it('a continuing page is checked together with the page before it', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    // Page 3 is an image-only diagram right after the TIR page: too thin to test alone.
    await t.h['quiz.pageCheck']({ docId, page: 3 })
    const check = rec.calls.find((c) => c.task === 'page_check')
    expect(check?.focus).toEqual({ from: 2, to: 3 })
    const pdf = check?.parts.find((p) => p.type === 'pdf')
    expect(pdf?.type === 'pdf' ? pdf.path : '').toMatch(/\/focus\/1-4\.pdf$/)
  })

  it('large scopes are split: the document per topic, ranges into windows that fit', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec, options: { windowPages: 4 } })
    const docId = await t.importIndexed()

    const doc = await t.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: false,
      count: null
    })
    expect((await t.queue.wait(doc.jobId)).state).toBe('done')
    // Topics are 1-5, 6-10 and 11-12; a 5-page topic exceeds the 4-page window and is halved.
    expect(rec.calls.filter((c) => c.task === 'cards').map((c) => c.focus)).toEqual([
      { from: 1, to: 3 },
      { from: 4, to: 5 },
      { from: 6, to: 8 },
      { from: 9, to: 10 },
      { from: 11, to: 12 }
    ])
  })

  it('ranges are split into windows that fit, merging small neighbours', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec, options: { windowPages: 4 } })
    const docId = await t.importIndexed()
    const range = await t.h['cards.generate']({
      scope: { kind: 'range', docId, from: 2, to: 12 },
      essentialsOnly: true,
      count: 8
    })
    expect((await t.queue.wait(range.jobId)).state).toBe('done')
    const windows = rec.calls.filter((c) => c.task === 'cards').map((c) => c.focus)
    // Adjacent small pieces merge back across topic boundaries while they fit.
    // Pieces 2-5 | 6-8, 9-10 (topic 6-10 halved) | 11-12; the last two fit one window together.
    expect(windows).toEqual([
      { from: 2, to: 5 },
      { from: 6, to: 8 },
      { from: 9, to: 12 }
    ])
  })
})

describe('page checks', () => {
  it('refuse title and contents pages without calling the model', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    const calls = rec.calls.length
    await expect(t.h['quiz.pageCheck']({ docId, page: 1 })).rejects.toEqual(
      new ServiceError('validation', NOTHING_TO_TEST)
    )
    expect(rec.calls.length).toBe(calls)
    expect(t.db.jobs.list(docId, 100).some((j) => j.kind === 'page_check')).toBe(false)
    await expect(t.h['quiz.pageCheck']({ docId, page: 13 })).rejects.toMatchObject({ kind: 'validation' })
  })

  it('index the page first when it is not indexed yet', async () => {
    t = await createHarness()
    const [summary] = await t.h['library.import']({ paths: [t.fixture] })
    const docId = summary?.id ?? ''
    await t.h['index.pause']({ docId })
    await t.waitIdle()
    const session = await t.h['quiz.pageCheck']({ docId, page: 12 })
    expect(session.questions.length).toBeGreaterThanOrEqual(3)
    expect(t.db.pages.notes(docId, 12)?.indexed).toBe(true)
  })

  it('are prefetched once 20 s of reading land on a teachable, indexed page', async () => {
    t = await createHarness()
    const docId = await t.importIndexed()
    const checkJob = (page: number) => t.db.jobs.findActive(`page_check:${docId}:${page}`)

    await t.h['reading.track']({ docId, page: 2, seconds: 15 })
    expect(checkJob(2)).toBeNull()
    await t.h['reading.track']({ docId, page: 2, seconds: 10 })
    expect(checkJob(2)?.priority).toBe(PRIORITY.prefetch)
    await t.waitIdle()
    await until(() => t.eventsOf('pageCheck.ready').length > 0)
    expect(t.eventsOf('pageCheck.ready')).toEqual([{ docId, page: 2 }])

    // Instant now: no new job.
    const jobs = t.db.jobs.list(docId, 1000).length
    expect((await t.h['quiz.pageCheck']({ docId, page: 2 })).questions.length).toBeGreaterThanOrEqual(3)
    expect(t.db.jobs.list(docId, 1000).length).toBe(jobs)

    // Not on a title page, and not when the setting is off.
    await t.h['reading.track']({ docId, page: 1, seconds: 30 })
    expect(checkJob(1)).toBeNull()
    await t.h['settings.update']({ prefetchPageChecks: false })
    await t.h['reading.track']({ docId, page: 4, seconds: 30 })
    expect(checkJob(4)).toBeNull()
    // Reading time feeds the planner.
    const [topic] = await t.h['plan.topics']({ docId })
    expect(topic?.minutesSpent).toBeCloseTo((15 + 10 + 30 + 30) / 60)
  })
})

describe('jobs and the queue', () => {
  it('a rate limit pauses the queue, tells the renderer, and fails waiting requests fast', async () => {
    const resetAt = new Date(Date.now() + HOUR).toISOString()
    const limited: LlmProvider = {
      ...createFakeProvider(),
      generate: async () => {
        throw new AiError('rate_limited', 'Usage limit reached', { resetAt })
      }
    }
    t = await createHarness({ provider: limited })
    const [summary] = await t.h['library.import']({ paths: [t.fixture] })
    await until(() => t.eventsOf('ai.rateLimited').length > 0)
    expect(t.eventsOf('ai.rateLimited')[0]).toEqual({ resetAt, message: 'Usage limit reached' })
    // Not failed: the jobs wait for the reset.
    expect(t.db.jobs.list(null, 100).every((j) => j.state === 'queued' || j.state === 'running')).toBe(true)

    await expect(t.h['quiz.pageCheck']({ docId: summary?.id ?? '', page: 2 })).rejects.toMatchObject({
      kind: 'rate_limited',
      resetAt
    })

    t.queue.pauseUntil(null)
    expect(t.eventsOf('ai.rateLimited')).toContainEqual(null satisfies RateLimitInfo | null)
  })

  it('the monthly budget stops anthropic-api jobs with a clear message', async () => {
    const rec = recordingProvider(createFakeProvider(), { id: 'anthropic-api' })
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    t.db.usage.record(
      {
        task: 'cards',
        model: 'claude-opus-5-5',
        provider: 'anthropic-api',
        docId,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 5,
          notional: false
        }
      },
      t.clock.now().toISOString()
    )
    await t.h['settings.update']({ monthlyBudgetUsd: 2 })

    const { jobId } = await t.h['cards.generate']({
      scope: { kind: 'page', docId, page: 2 },
      essentialsOnly: false,
      count: null
    })
    const job = await t.queue.wait(jobId)
    expect(job.state).toBe('failed')
    expect(job.error).toMatch(/Monthly AI budget reached: \$5\.00 of \$2\.00/)
    expect(job.attempts).toBe(1)
    expect(rec.calls.some((c) => c.task === 'cards')).toBe(false)

    // Requests that call the AI directly get the same message as an 'ai' error.
    const check = t.db.questions.insertMany(
      [
        {
          docId,
          topicId: null,
          type: 'short',
          stem: 'Explain TIR.',
          options: null,
          answer: { type: 'short', modelAnswer: 'Light is reflected.', rubric: ['reflection'] },
          explanation: 'x',
          optionRationales: null,
          difficulty: 2,
          sourcePages: [2],
          evidence: null,
          verification: 'not_applicable',
          fromBook: false
        }
      ],
      t.clock.now().toISOString()
    )
    const quizId = t.db.quizzes.create(
      {
        docId,
        mode: 'topic',
        scope: { kind: 'document', docId },
        questionIds: check.map((q) => q.id),
        timeLimit: null
      },
      t.clock.now().toISOString()
    )
    await expect(
      t.h['quiz.answer']({
        quizId,
        questionId: check[0]?.id ?? '',
        response: { type: 'short', text: 'Light' },
        elapsedMs: 1
      })
    ).rejects.toMatchObject({ kind: 'ai', message: expect.stringMatching(/budget/) })

    // Raising the budget lets work through again.
    await t.h['settings.update']({ monthlyBudgetUsd: null })
    const retry = await t.h['cards.generate']({
      scope: { kind: 'page', docId, page: 2 },
      essentialsOnly: false,
      count: null
    })
    expect((await t.queue.wait(retry.jobId)).state).toBe('done')
  })

  it('library.delete cancels the document jobs (aborting running calls) and removes rows and files', async () => {
    const hanging = hangingProvider()
    t = await createHarness({ provider: hanging, concurrency: 1 })
    const [summary] = await t.h['library.import']({ paths: [t.fixture] })
    const docId = summary?.id ?? ''
    await until(() => hanging.signals.length === 1)
    const stored = t.db.documents.get(docId)?.storedPath ?? ''
    expect((await stat(stored)).isFile()).toBe(true)

    expect(await t.h['library.delete']({ docId })).toEqual({ deleted: true })
    expect(hanging.signals[0]?.aborted).toBe(true)
    const cancelled = t.eventsOf('jobs.changed').filter((j) => j.state === 'cancelled')
    expect(cancelled.map((j) => j.kind)).toEqual(['index_chunk', 'index_chunk'])
    expect(t.db.jobs.list(null, 100)).toEqual([])
    expect(t.db.documents.get(docId)).toBeNull()
    await expect(stat(stored)).rejects.toThrow()
    await expect(t.h['library.get']({ docId })).rejects.toMatchObject({ kind: 'not_found' })
    await t.waitIdle()
  })

  it('index.focus moves the reader chunk up; index.pause cancels queued chunks', async () => {
    const hanging = hangingProvider()
    t = await createHarness({ provider: hanging, concurrency: 1 })
    const [summary] = await t.h['library.import']({ paths: [t.fixture] })
    const docId = summary?.id ?? ''
    await until(() => hanging.signals.length === 1)
    const second = t.db.jobs.findActive(`index:${docId}:1`)
    expect(second).toMatchObject({ state: 'queued', priority: 0, label: 'Indexing pages 11–12' })

    await t.h['index.focus']({ docId, page: 11 })
    expect(t.db.jobs.findActive(`index:${docId}:1`)?.priority).toBe(PRIORITY.focus)
    expect((await t.h['index.status']({ docId })).state).toBe('running')

    const paused = await t.h['index.pause']({ docId })
    expect(paused.state).toBe('paused')
    expect(t.db.jobs.get(second?.id ?? '')?.state).toBe('cancelled')
    // The running chunk keeps going; a paused document is not restarted by a re-import.
    expect(t.db.jobs.findActive(`index:${docId}:0`)?.state).toBe('running')
    await t.h['library.import']({ paths: [t.fixture] })
    expect(t.db.jobs.findActive(`index:${docId}:1`)).toBeNull()
    expect(t.eventsOf('index.progress').at(-1)?.status.state).toBe('paused')
  })
})

describe('quizzes', () => {
  it('from_book turns indexed exercises with answers into written questions, without generation', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    const notes = t.db.pages.notes(docId, 5)
    if (!notes) throw new Error('page 5 missing')
    t.db.pages.saveIndex(docId, 5, {
      ...notes,
      kind: notes.kind ?? 'exercise',
      summary: notes.summary ?? '',
      exercises: [
        {
          question: 'A 50 km link uses fibre with 0.2 dB/km attenuation. What is the fibre loss?',
          answer: 'The loss is 0.2 dB/km times 50 km. That gives 10 dB.'
        },
        { question: 'Sketch the link budget.', answer: null }
      ]
    })
    const before = rec.calls.length

    const quiz = await t.h['quiz.create']({
      scope: { kind: 'document', docId },
      mode: 'from_book',
      count: 5,
      types: null,
      timeLimit: null
    })
    expect(rec.calls.length).toBe(before)
    expect(quiz.mode).toBe('from_book')
    expect(quiz.questions).toHaveLength(1)
    const [q] = quiz.questions
    expect(q).toMatchObject({
      type: 'short',
      fromBook: true,
      sourcePages: [5],
      answer: {
        type: 'short',
        modelAnswer: 'The loss is 0.2 dB/km times 50 km. That gives 10 dB.',
        rubric: ['The loss is 0.2 dB/km times 50 km.', 'That gives 10 dB.']
      }
    })
    // Asking again reuses the stored question instead of duplicating it.
    await t.h['quiz.create']({
      scope: { kind: 'document', docId },
      mode: 'from_book',
      count: 5,
      types: null,
      timeLimit: null
    })
    expect(
      t.db.questions.list({ kind: 'document', docId }, { purpose: 'any', includeInactive: true })
    ).toHaveLength(1)

    const graded = await t.h['quiz.answer']({
      quizId: quiz.id,
      questionId: q?.id ?? '',
      response: { type: 'short', text: 'The loss is 0.2 dB/km times 50 km, that gives 10 dB.' },
      elapsedMs: 1000
    })
    expect(graded.correct).toBe(true)
    expect(rec.calls.at(-1)?.task).toBe('grade')
  })

  it('finishing a quiz re-solves the saved plan with the new mastery', async () => {
    t = await createHarness()
    const docId = await t.importIndexed()
    const input = {
      examDate: '2026-10-20',
      totalHours: 3,
      hoursPerDay: null,
      targetScore: 0.8,
      mode: 'max_score' as const,
      format: 'mcq' as const,
      overrides: []
    }
    const saved = await t.h['plan.save']({ docId, input })
    t.clock.advance(HOUR)

    const check = await t.h['quiz.pageCheck']({ docId, page: 2 })
    for (const q of check.questions) {
      await t.h['quiz.answer']({
        quizId: check.id,
        questionId: q.id,
        response: wrongResponse(q),
        elapsedMs: 10
      })
    }
    await t.h['quiz.finish']({ quizId: check.id })
    const replanned = await t.h['plan.get']({ docId })
    expect(replanned?.id).toBe(saved.id)
    expect(replanned?.input).toEqual(input)
    expect(replanned?.updatedAt).toBe(t.clock.now().toISOString())
    const [first] = await t.h['topics.list']({ docId })
    expect(t.db.topics.mastery(first?.id ?? '')).toEqual({ alpha: 1, beta: 1 + check.questions.length })
  })

  it('planning works before the topic map exists (no topics yet) and today is null without a plan', async () => {
    t = await createHarness()
    const [summary] = await t.h['library.import']({ paths: [t.fixture] })
    const docId = summary?.id ?? ''
    await t.h['index.pause']({ docId })
    await t.waitIdle()
    expect(await t.h['plan.today']({ docId })).toBeNull()
    expect(await t.h['plan.topics']({ docId })).toEqual([])
    const plan = await t.h['plan.save']({
      docId,
      input: {
        examDate: null,
        totalHours: 5,
        hoursPerDay: null,
        targetScore: 0.6,
        mode: 'min_time',
        format: 'written',
        overrides: []
      }
    })
    expect(plan.result.items).toEqual([])
  })

  it('topic quizzes reuse fresh questions and generate only the rest; mistakes come back for review', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    const [, second] = await t.h['topics.list']({ docId })
    const scope = { kind: 'topic' as const, docId, topicId: second?.id ?? '' }

    const quiz = await t.h['quiz.create']({
      scope,
      mode: 'topic',
      count: 2,
      types: ['mcq', 'tf'],
      timeLimit: null
    })
    expect(quiz.questions.map((q) => q.type)).toEqual(['mcq', 'tf'])
    expect(quiz.questions.every((q) => q.topicId === second?.id)).toBe(true)
    const generations = (): number => rec.calls.filter((c) => c.task === 'questions').length
    expect(generations()).toBe(1)

    // Answer the first wrong, then ask for mistakes.
    for (const [i, q] of quiz.questions.entries()) {
      const response = i === 0 ? wrongResponse(q) : correctResponse(q)
      await t.h['quiz.answer']({ quizId: quiz.id, questionId: q.id, response, elapsedMs: 10 })
    }
    const review = await t.h['quiz.create']({
      scope,
      mode: 'review_mistakes',
      count: 10,
      types: null,
      timeLimit: null
    })
    expect(review.questions.map((q) => q.id)).toEqual([quiz.questions[0]?.id])

    // A week later the same questions are fresh again: reused, no new generation.
    t.clock.advance(8 * 24 * HOUR)
    const later = await t.h['quiz.create']({
      scope,
      mode: 'topic',
      count: 2,
      types: ['mcq', 'tf'],
      timeLimit: null
    })
    expect(later.questions.map((q) => q.id).sort()).toEqual(quiz.questions.map((q) => q.id).sort())
    expect(generations()).toBe(1)

    await expect(
      t.h['quiz.answer']({
        quizId: quiz.id,
        questionId: review.questions[0]?.id ?? '',
        response: correctResponse(review.questions[0] ?? quiz.questions[0]!),
        elapsedMs: 10
      })
    ).resolves.toMatchObject({ correct: true })
    await t.h['quiz.finish']({ quizId: quiz.id })
    await expect(
      t.h['quiz.answer']({
        quizId: quiz.id,
        questionId: quiz.questions[0]?.id ?? '',
        response: { type: 'tf', value: true },
        elapsedMs: 1
      })
    ).rejects.toMatchObject({ kind: 'conflict' })
  })

  it('mock exams spread questions over topics by exam weight and missing mastery', async () => {
    const rec = recordingProvider()
    t = await createHarness({ provider: rec })
    const docId = await t.importIndexed()
    const topics = await t.h['topics.list']({ docId })
    // Topic 1 is mastered: it should get no questions.
    t.db.topics.addMasteryEvidence(topics[0]?.id ?? '', 50, 0)

    const mock = await t.h['quiz.create']({
      scope: { kind: 'document', docId },
      mode: 'mock',
      count: 6,
      types: null,
      timeLimit: 45
    })
    expect(mock).toMatchObject({ mode: 'mock', timeLimit: 45 })
    expect(mock.questions.length).toBeGreaterThan(0)
    const topicIds = new Set(mock.questions.map((q) => q.topicId))
    expect(topicIds.has(topics[0]?.id ?? '')).toBe(false)
    const mockCalls = rec.calls.filter((c) => c.task === 'questions')
    expect(mockCalls.length).toBeGreaterThan(0)
    expect(mockCalls.every((c) => (c.focus?.from ?? 0) >= 6)).toBe(true)
  })
})
