import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { afterAll, describe, expect, it, vi } from 'vitest'
import type {
  Card,
  DocumentSummary,
  JobInfo,
  PageNotes,
  Question,
  QuizResult,
  QuizSession,
  Topic
} from '@shared/domain'
import type { ExamPlan, PlanTopic } from '@shared/planner/types'
import { memoryLog, stubHandlers } from '../ipc/test-helpers'
import { ServiceError, type Handlers } from '../pipelines/types'
import {
  responseFor,
  runSmoke,
  SmokeError,
  SMOKE_PDF_TITLE,
  waitForRendererLoad,
  writeSmokePdf,
  type SmokeOptions
} from './smoke'

const T = '2026-10-17T10:00:00.000Z'
const DOC_ID = 'doc-1'

const doc: DocumentSummary = {
  id: DOC_ID,
  title: SMOKE_PDF_TITLE,
  pageCount: 4,
  importedAt: T,
  lastOpenedAt: null,
  lastPage: 1,
  index: { state: 'none', indexedPages: 0, totalPages: 4 },
  cardsDue: 0,
  mastery: null,
  examDate: null
}

const topic: Topic = {
  id: 'topic-1',
  docId: DOC_ID,
  parentId: null,
  order: 0,
  title: 'Signals',
  pageStart: 1,
  pageEnd: 4,
  objectives: [],
  estimates: null,
  mastery: null
}

const card: Card = {
  id: 'card-1',
  docId: DOC_ID,
  topicId: 'topic-1',
  type: 'basic',
  front: 'What is the Nyquist rate?',
  back: 'Twice the highest frequency.',
  essential: true,
  sourcePages: [2],
  evidence: null,
  verification: 'verified',
  status: 'active',
  srs: {
    due: T,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReview: null,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0
  },
  createdAt: T
}

const question = (id: string, answer: Question['answer']): Question => ({
  id,
  docId: DOC_ID,
  topicId: 'topic-1',
  type: answer.type,
  stem: 'Stem',
  options: answer.type === 'mcq' || answer.type === 'multi' ? ['a', 'b', 'c'] : null,
  answer,
  explanation: '',
  optionRationales: null,
  difficulty: 2,
  sourcePages: [2],
  evidence: null,
  verification: 'verified',
  status: 'active',
  fromBook: false,
  createdAt: T
})

const session: QuizSession = {
  id: 'quiz-1',
  docId: DOC_ID,
  mode: 'page_check',
  scope: { kind: 'page', docId: DOC_ID, page: 2 },
  questions: [
    question('q-1', { type: 'mcq', correctIndex: 2 }),
    question('q-2', { type: 'tf', value: false })
  ],
  createdAt: T,
  timeLimit: null
}

const notes = (page: number): PageNotes => ({
  docId: DOC_ID,
  page,
  label: null,
  indexed: true,
  kind: page === 1 ? 'title' : 'content',
  teachable: page !== 1,
  summary: null,
  keyPoints: [],
  concepts: [],
  formulas: [],
  exercises: [],
  examSignals: []
})

const quizResult: QuizResult = {
  quizId: 'quiz-1',
  score: 2,
  maxScore: 2,
  attempts: [],
  perTopic: [],
  reviewPages: [],
  finishedAt: T
}

const planTopic: PlanTopic = {
  id: 'topic-1',
  title: 'Signals',
  examWeight: 1,
  coreFraction: 0.6,
  coreMinutes: 30,
  fullMinutes: 60,
  prerequisites: [],
  mastery: null,
  minutesSpent: 0
}

const plan = (input: ExamPlan['input']): ExamPlan => ({
  id: 'plan-1',
  docId: DOC_ID,
  input,
  result: {
    feasible: true,
    expectedScore: 0.8,
    targetScore: input.targetScore,
    budgetMinutes: 600,
    reserveMinutes: 120,
    plannedMinutes: 60,
    items: [],
    notes: []
  },
  schedule: { days: [{ date: '2026-10-17', sessions: [], totalMinutes: 0 }] },
  createdAt: T,
  updatedAt: T
})

const job = (state: JobInfo['state'], over: Partial<JobInfo> = {}): JobInfo => ({
  id: 'job-cards',
  kind: 'generate_cards',
  docId: DOC_ID,
  state,
  progress: state === 'done' ? 1 : 0.5,
  label: 'Cards',
  error: null,
  attempts: 1,
  createdAt: T,
  updatedAt: T,
  ...over
})

/** Fake pipelines that behave like the real ones: async work completes after a few polls. */
function scenario(over: Partial<Handlers> = {}) {
  let statusPolls = 0
  let topicPolls = 0
  let cardJobPolls = 0
  let cardsRequested = false
  const answer = vi.fn<Handlers['quiz.answer']>((input) =>
    Promise.resolve({
      questionId: input.questionId,
      correct: true,
      score: 1,
      feedback: null,
      missingPoints: [],
      correctAnswer: 'c'
    })
  )
  const save = vi.fn<Handlers['plan.save']>(({ input }) => Promise.resolve(plan(input)))
  const impl: Partial<Handlers> = {
    'library.import': () => Promise.resolve([doc]),
    'index.start': () => Promise.resolve({ state: 'queued', indexedPages: 0, totalPages: 4 }),
    'index.status': () => {
      statusPolls++
      return Promise.resolve(
        statusPolls < 3
          ? { state: 'running', indexedPages: statusPolls, totalPages: 4 }
          : { state: 'done', indexedPages: 4, totalPages: 4 }
      )
    },
    'topics.list': () => Promise.resolve(++topicPolls < 2 ? [] : [topic]),
    'jobs.list': () => {
      if (!cardsRequested) return Promise.resolve([])
      return Promise.resolve([job(++cardJobPolls < 2 ? 'running' : 'done')])
    },
    'cards.generate': () => {
      cardsRequested = true
      return Promise.resolve({ jobId: 'job-cards' })
    },
    'cards.due': () => Promise.resolve([card]),
    'cards.review': () => Promise.resolve(card),
    'library.pageNotes': ({ page }) => Promise.resolve(notes(page)),
    'quiz.pageCheck': () => Promise.resolve(session),
    'quiz.answer': answer,
    'quiz.finish': () => Promise.resolve(quizResult),
    'plan.topics': () => Promise.resolve([planTopic]),
    'plan.save': save,
    'plan.today': () => Promise.resolve(null),
    'usage.summary': () => Promise.resolve({ notional: true, todayUsd: 0, monthUsd: 0, byTask: [] }),
    ...over
  }
  return { handlers: stubHandlers(impl), answer, save }
}

const options = (over: Partial<SmokeOptions> = {}): SmokeOptions => ({
  pdfPath: '/tmp/smoke.pdf',
  log: memoryLog(),
  timeoutMs: 5_000,
  pollMs: 1,
  now: () => new Date(T),
  ...over
})

const STEPS = [
  'library.import',
  'index.start',
  'index.status',
  'topics.list',
  'cards.generate',
  'jobs.list',
  'cards.due',
  'cards.review',
  'library.pageNotes',
  'quiz.pageCheck',
  'quiz.answer',
  'quiz.finish',
  'plan.topics',
  'plan.save',
  'plan.today',
  'usage.summary'
]

async function smokeError(run: Promise<unknown>): Promise<SmokeError> {
  const err = await run.then(
    () => null,
    (e: unknown) => e
  )
  if (!(err instanceof SmokeError)) throw new Error(`expected a SmokeError, got ${String(err)}`)
  return err
}

describe('runSmoke', () => {
  it('runs the whole flow and reports every step with timings', async () => {
    const { handlers, answer, save } = scenario()
    const log = memoryLog()
    const report = await runSmoke(handlers, options({ log }))

    expect(report.docId).toBe(DOC_ID)
    expect(report.steps.map((s) => s.name)).toEqual(STEPS)
    for (const s of report.steps) expect(s.ms).toBeGreaterThanOrEqual(0)
    expect(report.steps.find((s) => s.name === 'library.pageNotes')?.detail).toBe('teachable page 2')
    expect(report.steps.find((s) => s.name === 'quiz.answer')?.detail).toBe('2/2 correct')

    // Answers come from the answer key.
    expect(answer.mock.calls.map(([input]) => input.response)).toEqual([
      { type: 'mcq', index: 2 },
      { type: 'tf', value: false }
    ])
    expect(save.mock.calls[0]?.[0].input).toMatchObject({
      examDate: '2026-10-31',
      hoursPerDay: 2,
      overrides: []
    })
    expect(log.lines.at(-1)?.message).toContain('all 16 steps passed')
  })

  it('names the failing step and keeps the steps that passed', async () => {
    const { handlers } = scenario({ 'quiz.pageCheck': () => Promise.resolve({ ...session, questions: [] }) })
    const err = await smokeError(runSmoke(handlers, options()))
    expect(err.step).toBe('quiz.pageCheck')
    expect(err.message).toBe('smoke step "quiz.pageCheck" failed: page check for page 2 has no questions')
    expect(err.steps.map((s) => s.name)).toEqual(STEPS.slice(0, STEPS.indexOf('quiz.pageCheck')))
  })

  it('surfaces the handler error message', async () => {
    const { handlers } = scenario({
      'cards.generate': () => Promise.reject(new ServiceError('ai', 'Model refused'))
    })
    const err = await smokeError(runSmoke(handlers, options()))
    expect(err.step).toBe('cards.generate')
    expect(err.message).toContain('Model refused')
    expect(err.cause).toBeInstanceOf(ServiceError)
  })

  it('fails fast when indexing ends in error', async () => {
    const { handlers } = scenario({
      'index.status': () =>
        Promise.resolve({ state: 'error', indexedPages: 1, totalPages: 4, error: 'chunk 0 failed' })
    })
    const err = await smokeError(runSmoke(handlers, options({ timeoutMs: 60_000 })))
    expect(err.step).toBe('index.status')
    expect(err.message).toContain('chunk 0 failed')
  })

  it('fails fast when the topic map job failed', async () => {
    const { handlers } = scenario({
      'topics.list': () => Promise.resolve([]),
      'jobs.list': () =>
        Promise.resolve([job('failed', { id: 'job-topics', kind: 'topic_map', error: 'invalid output' })])
    })
    const err = await smokeError(runSmoke(handlers, options({ timeoutMs: 60_000 })))
    expect(err.step).toBe('topics.list')
    expect(err.message).toContain('invalid output')
  })

  it('fails when the card job fails', async () => {
    const { handlers } = scenario({
      'jobs.list': () => Promise.resolve([job('failed', { error: 'no chunks' })])
    })
    const err = await smokeError(runSmoke(handlers, options()))
    expect(err.step).toBe('jobs.list')
    expect(err.message).toContain('no chunks')
  })

  it('times out a step that never completes', async () => {
    const { handlers } = scenario({
      'index.status': () => Promise.resolve({ state: 'running', indexedPages: 0, totalPages: 4 })
    })
    const err = await smokeError(runSmoke(handlers, options({ timeoutMs: 80, pollMs: 5 })))
    expect(err.step).toBe('index.status')
    expect(err.message).toMatch(/timed out/)
  })

  it('times out a handler that hangs', async () => {
    const { handlers } = scenario({ 'usage.summary': () => new Promise(() => undefined) })
    const err = await smokeError(runSmoke(handlers, options({ timeoutMs: 150 })))
    expect(err.step).toBe('usage.summary')
  })
})

describe('responseFor', () => {
  it.each<[Question['answer'], ReturnType<typeof responseFor>]>([
    [
      { type: 'mcq', correctIndex: 1 },
      { type: 'mcq', index: 1 }
    ],
    [
      { type: 'multi', correctIndices: [0, 2] },
      { type: 'multi', indices: [0, 2] }
    ],
    [
      { type: 'tf', value: true },
      { type: 'tf', value: true }
    ],
    [
      { type: 'short', modelAnswer: 'Because.', rubric: [] },
      { type: 'short', text: 'Because.' }
    ],
    [
      { type: 'numeric', value: 20, tolerance: 0.02, unit: 'dB' },
      { type: 'numeric', value: 20, unit: 'dB' }
    ]
  ])('answers %o correctly', (answer, expected) => {
    expect(responseFor({ answer })).toEqual(expected)
  })
})

describe('writeSmokePdf', () => {
  const dirs: string[] = []
  afterAll(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true })
  })

  it('writes a 4-page titled PDF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sb-smoke-'))
    dirs.push(dir)
    const path = await writeSmokePdf(join(dir, 'nested'))
    const pdf = await PDFDocument.load(await readFile(path))
    expect(pdf.getPageCount()).toBe(4)
    expect(pdf.getTitle()).toBe(SMOKE_PDF_TITLE)
  })
})

describe('waitForRendererLoad', () => {
  it('resolves when the renderer finished loading', async () => {
    const contents = new EventEmitter()
    const done = waitForRendererLoad(contents, 1_000)
    contents.emit('did-finish-load')
    await expect(done).resolves.toBeUndefined()
  })

  it('rejects when loading fails', async () => {
    const contents = new EventEmitter()
    const done = waitForRendererLoad(contents, 1_000)
    contents.emit('did-fail-load', {}, -6, 'ERR_FILE_NOT_FOUND')
    await expect(done).rejects.toThrow('renderer failed to load: -6 ERR_FILE_NOT_FOUND')
  })

  it('rejects after the timeout', async () => {
    await expect(waitForRendererLoad(new EventEmitter(), 10)).rejects.toThrow('timeout')
  })
})
