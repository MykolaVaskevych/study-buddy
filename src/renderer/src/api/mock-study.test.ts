import { vi } from 'vitest'
import type { IpcChannel, IpcInput, IpcOutput } from '@shared/ipc/contract'
import { createMockApi } from './mock'

const docId = 'optical-networks'
const now = new Date('2026-10-17T10:00:00Z')

function setup() {
  const api = createMockApi({ latency: [0, 0], simulate: false, now: () => now })
  const call = async <C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> => {
    const res = await api.invoke(channel, input)
    if (!res.ok) throw new Error(`${channel}: ${res.error.message}`)
    return res.data
  }
  return { api, call }
}

describe('mock study api', () => {
  it('serves page checks and topic quizzes with every question type', async () => {
    const { call } = setup()
    const check = await call('quiz.pageCheck', { docId, page: 40 })
    expect(check.questions.map((q) => q.type)).toEqual(['mcq', 'numeric', 'tf'])
    // Asking again serves the page's next questions, like main's "fresh" page checks.
    const again = await call('quiz.pageCheck', { docId, page: 40 })
    expect(again.questions.map((q) => q.stem)).not.toEqual(check.questions.map((q) => q.stem))
    // Title pages are refused, as main does.
    await expect(call('quiz.pageCheck', { docId, page: 1 })).rejects.toThrow(/Nothing to test/)
    const quiz = await call('quiz.create', {
      scope: { kind: 'topic', docId, topicId: `${docId}:Attenuation and the power budget` },
      mode: 'topic',
      count: 60,
      types: null,
      timeLimit: null
    })
    expect(new Set(quiz.questions.map((q) => q.type))).toEqual(
      new Set(['mcq', 'multi', 'tf', 'short', 'numeric'])
    )
    const onlyNumeric = await call('quiz.create', {
      scope: { kind: 'document', docId },
      mode: 'mock',
      count: 5,
      types: ['numeric'],
      timeLimit: 10
    })
    expect(onlyNumeric.questions.every((q) => q.type === 'numeric')).toBe(true)
    expect(onlyNumeric.timeLimit).toBe(10)
  })

  it('grades with the shared graders, records history and retries mistakes', async () => {
    const { call } = setup()
    const check = await call('quiz.pageCheck', { docId, page: 40 })
    const [mcq, numeric] = check.questions
    if (!mcq || !numeric) throw new Error('missing questions')
    const right = await call('quiz.answer', {
      quizId: check.id,
      questionId: numeric.id,
      response: { type: 'numeric', value: -16, unit: 'dBm' },
      elapsedMs: 1
    })
    expect(right.correct).toBe(true)
    const wrongUnit = await call('quiz.answer', {
      quizId: check.id,
      questionId: numeric.id,
      response: { type: 'numeric', value: -16, unit: 'dB' },
      elapsedMs: 1
    })
    expect(wrongUnit.correct).toBe(false)
    expect(wrongUnit.feedback).toMatch(/dB is a ratio/)
    await call('quiz.answer', {
      quizId: check.id,
      questionId: mcq.id,
      response: { type: 'mcq', index: 2 },
      elapsedMs: 1
    })

    const result = await call('quiz.finish', { quizId: check.id })
    expect(result).toMatchObject({ score: 0, maxScore: 3, reviewPages: [40] })
    expect(await call('quiz.history', { docId, limit: 5 })).toHaveLength(1)

    const retry = await call('quiz.create', {
      scope: { kind: 'page', docId, page: 40 },
      mode: 'review_mistakes',
      count: 10,
      types: null,
      timeLimit: null
    })
    expect(retry.questions.map((q) => q.id).sort()).toEqual([mcq.id, numeric.id].sort())
  })

  it('marks short answers against the rubric', async () => {
    const { call } = setup()
    const quiz = await call('quiz.create', {
      scope: { kind: 'page', docId, page: 40 },
      mode: 'topic',
      count: 5,
      types: ['short'],
      timeLimit: null
    })
    const q = quiz.questions[0]
    if (!q) throw new Error('no short question')
    const r = await call('quiz.answer', {
      quizId: quiz.id,
      questionId: q.id,
      response: { type: 'short', text: 'dB is a ratio of two powers.' },
      elapsedMs: 1
    })
    expect(r.score).toBeCloseTo(1 / 3)
    expect(r.missingPoints).toHaveLength(2)
  })

  it('reports the next due card and generates cards through a job', async () => {
    const { api, call } = setup()
    const stats = await call('cards.stats', { docId })
    expect(stats.due).toBeGreaterThan(0)
    expect(stats.nextDue && stats.nextDue > now.toISOString()).toBe(true)

    const onJob = vi.fn()
    api.on('jobs.changed', onJob)
    const before = (
      await call('cards.list', { scope: { kind: 'page', docId, page: 40 }, includeInactive: true })
    ).length
    const { jobId } = await call('cards.generate', {
      scope: { kind: 'page', docId, page: 40 },
      essentialsOnly: false,
      count: null
    })
    expect(onJob).toHaveBeenLastCalledWith(
      expect.objectContaining({ id: jobId, state: 'done', kind: 'generate_cards' })
    )
    const after = await call('cards.list', {
      scope: { kind: 'page', docId, page: 40 },
      includeInactive: true
    })
    expect(after.length).toBeGreaterThan(before)
  })
})
