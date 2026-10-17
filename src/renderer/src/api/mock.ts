import { ipcContract } from '@shared/ipc/contract'
import type {
  IpcChannel,
  IpcEnvelope,
  IpcErrorKind,
  IpcEvent,
  IpcEvents,
  IpcInput,
  IpcOutput,
  PreloadApi
} from '@shared/ipc/contract'
import type {
  AttemptResult,
  Card,
  DocumentDetail,
  DocumentSummary,
  IndexStatus,
  JobInfo,
  PageNotes,
  Question,
  QuizResult,
  QuizSession,
  Scope,
  SearchHit,
  Topic
} from '@shared/domain'
import type { PublicSettings } from '@shared/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ExamPlan, PlanTopic, StudyDay } from '@shared/planner/types'
import { BOOKS, flattenTopics, pageText, slideFor } from './mock-data'
import type { BookSpec } from './mock-data'
import { makeBookPdf } from './mock-pdf'
import type { PdfSourceResolver } from './pdfSource'

/**
 * In-memory implementation of every IPC channel for browser mode (`npm run dev:web`) and tests.
 * Inputs are validated with the real contract schemas, so renderer bugs surface here too.
 * When `simulate` is on, background jobs tick and push events like main would.
 */

export interface MockOptions {
  /** Artificial latency range in ms; [0, 0] in tests. */
  latency?: [number, number]
  /** Run timers that progress indexing jobs and emit events. */
  simulate?: boolean
  now?: () => Date
}

export interface MockApi extends PreloadApi {
  emit<E extends IpcEvent>(event: E, payload: IpcEvents[E]): void
  /** Browser files have no path; the mock imports them by name. */
  pathForFile(file: File): string
  pdfSource: PdfSourceResolver
  /** Devtools helpers: `sbMock.rateLimit(2)` shows the banner for 2 minutes. */
  rateLimit(minutes: number): void
  dispose(): void
}

type Handlers = { [C in IpcChannel]: (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>> }

class MockError extends Error {
  constructor(
    readonly kind: IpcErrorKind,
    message: string
  ) {
    super(message)
  }
}

interface DocState {
  spec: BookSpec
  title: string
  lastPage: number
  lastOpenedAt: string | null
  importedAt: string
  examDate: string | null
  indexed: boolean[]
  indexState: IndexStatus['state']
  /** Chunk start pages still to index; the reader's chunk is moved to the front. */
  queue: number[]
  topicsBuilt: boolean
  cards: Card[]
}

const CHUNK = 10
const DAY = 86_400_000

const isoDaysFrom = (now: Date, days: number): string => new Date(now.getTime() + days * DAY).toISOString()

function chunkStarts(pageCount: number, done: (p: number) => boolean): number[] {
  const out: number[] = []
  for (let p = 1; p <= pageCount; p += CHUNK) if (!done(p)) out.push(p)
  return out
}

function makeCards(spec: BookSpec, now: Date): Card[] {
  const slides = flattenTopics(spec.topics).flatMap(({ spec: t }) =>
    t.slides.flatMap((s) => (s.formulas ?? []).map((f) => ({ t, f })))
  )
  return slides.slice(0, Math.max(2, spec.cardsDue > 0 ? 6 : 2)).map(({ t, f }, i) => ({
    id: `${spec.id}-card-${i + 1}`,
    docId: spec.id,
    topicId: `${spec.id}:${t.title}`,
    type: 'formula',
    front: `What does this formula give you? $${f.latex}$`,
    back: f.meaning,
    essential: f.importance === 'core',
    sourcePages: [t.from],
    evidence: null,
    verification: 'verified',
    status: 'active',
    srs: {
      due: isoDaysFrom(now, i < 3 ? -1 : 3),
      stability: 2.5,
      difficulty: 5,
      reps: i,
      lapses: 0,
      state: i === 0 ? 'new' : 'review',
      lastReview: i === 0 ? null : isoDaysFrom(now, -2),
      elapsedDays: 2,
      scheduledDays: 3,
      learningSteps: 0
    },
    createdAt: isoDaysFrom(now, -5)
  }))
}

function initialState(spec: BookSpec, now: Date): DocState {
  const indexed = Array.from({ length: spec.pageCount }, (_, i) => i + 1 <= spec.indexedThrough)
  const complete = spec.indexedThrough >= spec.pageCount
  return {
    spec,
    title: spec.title,
    lastPage: spec.lastPage,
    lastOpenedAt: spec.openedDaysAgo === null ? null : isoDaysFrom(now, -spec.openedDaysAgo),
    importedAt: isoDaysFrom(now, -spec.importedDaysAgo),
    examDate: spec.examInDays === null ? null : isoDaysFrom(now, spec.examInDays),
    indexed,
    indexState: complete ? 'done' : spec.indexedThrough > 0 ? 'running' : 'none',
    queue: chunkStarts(spec.pageCount, (p) => indexed[p - 1] === true),
    topicsBuilt: spec.topicsBuilt,
    cards: makeCards(spec, now)
  }
}

export function createMockApi(options: MockOptions = {}): MockApi {
  const { latency = [60, 220], simulate = true } = options
  const now = options.now ?? (() => new Date())
  const docs = new Map<string, DocState>(BOOKS.map((b) => [b.id, initialState(b, now())]))
  const jobs = new Map<string, JobInfo>()
  const quizzes = new Map<string, QuizSession>()
  const answers = new Map<string, AttemptResult[]>()
  const plans = new Map<string, ExamPlan>()
  const pdfCache = new Map<string, Promise<Uint8Array>>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  let settings: PublicSettings = { ...DEFAULT_SETTINGS, hasApiKey: false }
  let seq = 0
  const nextId = (prefix: string): string => `${prefix}-${++seq}`

  const listeners: { [E in IpcEvent]: Set<(payload: IpcEvents[E]) => void> } = {
    'jobs.changed': new Set(),
    'index.progress': new Set(),
    'library.changed': new Set(),
    'cards.changed': new Set(),
    'pageCheck.ready': new Set(),
    'ai.rateLimited': new Set()
  }
  const emit = <E extends IpcEvent>(event: E, payload: IpcEvents[E]): void => {
    for (const l of listeners[event]) l(payload)
  }

  const getDoc = (docId: string): DocState => {
    const d = docs.get(docId)
    if (!d) throw new MockError('not_found', `Document ${docId} not found`)
    return d
  }

  const indexStatus = (d: DocState): IndexStatus => ({
    state: d.indexState,
    indexedPages: d.indexed.filter(Boolean).length,
    totalPages: d.spec.pageCount
  })

  const summary = (d: DocState): DocumentSummary => {
    const masteries = flattenTopics(d.spec.topics)
      .map(({ spec }) => spec.mastery)
      .filter((m): m is number => m !== null)
    return {
      id: d.spec.id,
      title: d.title,
      pageCount: d.spec.pageCount,
      importedAt: d.importedAt,
      lastOpenedAt: d.lastOpenedAt,
      lastPage: d.lastPage,
      index: indexStatus(d),
      cardsDue: d.cards.filter((c) => c.status === 'active' && c.srs.due <= now().toISOString()).length,
      mastery: masteries.length ? masteries.reduce((a, b) => a + b, 0) / masteries.length : null,
      examDate: d.examDate
    }
  }

  const topicsOf = (d: DocState): Topic[] => {
    if (!d.topicsBuilt) return []
    return flattenTopics(d.spec.topics).map(({ spec, parent }, order) => ({
      id: `${d.spec.id}:${spec.title}`,
      docId: d.spec.id,
      parentId: parent ? `${d.spec.id}:${parent.title}` : null,
      order,
      title: spec.title,
      pageStart: spec.from,
      pageEnd: spec.to,
      objectives: spec.objectives,
      estimates: {
        difficulty: spec.difficulty,
        examWeight: spec.examWeight,
        examWeightReasons: ['Covered by past exam questions'],
        coreFraction: spec.coreFraction,
        coreMinutes: spec.coreMinutes,
        fullMinutes: spec.fullMinutes,
        prerequisites: []
      },
      mastery: spec.mastery
    }))
  }

  const notes = (d: DocState, page: number): PageNotes => {
    if (page > d.spec.pageCount) throw new MockError('validation', `Page ${page} is past the end`)
    const base: PageNotes = {
      docId: d.spec.id,
      page,
      label: String(page),
      indexed: d.indexed[page - 1] === true,
      kind: null,
      teachable: false,
      summary: null,
      keyPoints: [],
      concepts: [],
      formulas: [],
      exercises: [],
      examSignals: []
    }
    if (!base.indexed) return base
    const s = slideFor(d.spec, page)
    const kind = s.kind ?? 'content'
    return {
      ...base,
      kind,
      teachable: kind === 'content' || kind === 'exercise',
      summary: s.summary || null,
      keyPoints: s.keyPoints,
      concepts: s.concepts ?? [],
      formulas: s.formulas ?? [],
      exercises: s.exercises ?? [],
      examSignals: s.signals ?? []
    }
  }

  // ---------------------------------------------------------------- jobs simulation

  const upsertJob = (job: JobInfo): void => {
    jobs.set(job.id, job)
    emit('jobs.changed', job)
  }

  const indexJobs = new Map<string, string>()

  const tickIndex = (d: DocState): void => {
    if (d.indexState !== 'running') return
    const start = d.queue.shift()
    if (start === undefined) return
    const end = Math.min(d.spec.pageCount, start + CHUNK - 1)
    for (let p = start; p <= end; p++) d.indexed[p - 1] = true
    const status = indexStatus(d)
    const jobId = indexJobs.get(d.spec.id) ?? nextId('job')
    indexJobs.set(d.spec.id, jobId)
    const done = d.queue.length === 0
    if (done) d.indexState = 'done'
    upsertJob({
      id: jobId,
      kind: 'index_chunk',
      docId: d.spec.id,
      state: done ? 'done' : 'running',
      progress: status.indexedPages / status.totalPages,
      label: done
        ? `Indexed ${d.title}`
        : `Indexing ${d.title}, pages ${end + 1}–${Math.min(d.spec.pageCount, end + CHUNK)}`,
      error: null,
      attempts: 1,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    })
    emit('index.progress', { docId: d.spec.id, status: indexStatus(d) })
    if (done) {
      indexJobs.delete(d.spec.id)
      if (!d.topicsBuilt) buildTopics(d)
    }
  }

  const buildTopics = (d: DocState): { jobId: string } => {
    const job: JobInfo = {
      id: nextId('job'),
      kind: 'topic_map',
      docId: d.spec.id,
      state: 'running',
      progress: 0.1,
      label: `Building the course map for ${d.title}`,
      error: null,
      attempts: 1,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    }
    upsertJob(job)
    const finish = (): void => {
      d.topicsBuilt = true
      upsertJob({ ...job, state: 'done', progress: 1, updatedAt: now().toISOString() })
      emit('library.changed', { docId: d.spec.id })
    }
    if (simulate) setTimeout(finish, 3000)
    else finish()
    return { jobId: job.id }
  }

  if (simulate) {
    const timer = setInterval(() => {
      for (const d of docs.values()) tickIndex(d)
    }, 3500)
    timers.add(timer)
    // Announce the job that is already running in the demo library.
    setTimeout(() => {
      for (const d of docs.values()) if (d.indexState === 'running') tickIndex(d)
    }, 800)
  }

  // ---------------------------------------------------------------- quizzes

  const pageQuestions = (d: DocState, page: number): Question[] => {
    const s = slideFor(d.spec, page)
    const base = {
      docId: d.spec.id,
      topicId: null,
      difficulty: 2,
      sourcePages: [page],
      evidence: s.summary || null,
      verification: 'verified' as const,
      status: 'active' as const,
      fromBook: false,
      createdAt: now().toISOString(),
      optionRationales: null
    }
    const formula = s.formulas?.[0]
    return [
      {
        ...base,
        id: nextId('q'),
        type: 'tf',
        stem: `True or false: ${s.keyPoints[0] ?? s.summary}`,
        options: null,
        answer: { type: 'tf', value: true },
        explanation: `This is stated on page ${page} [p. ${page}].`
      },
      {
        ...base,
        id: nextId('q'),
        type: 'mcq',
        stem: formula ? `Which formula describes: ${formula.meaning}` : `What is page ${page} mainly about?`,
        options: formula
          ? [`$${formula.latex}$`, '$P = I^2 R$', '$E = mc^2$', '$V = IR$']
          : [s.title, 'Something else', 'None of these', 'All of these'],
        answer: { type: 'mcq', correctIndex: 0 },
        explanation: `See [p. ${page}].`
      }
    ]
  }

  const grade = (q: Question, response: IpcInput<'quiz.answer'>['response']): AttemptResult => {
    let correct = false
    let score = 0
    const a = q.answer
    if (a.type === 'mcq' && response.type === 'mcq') correct = a.correctIndex === response.index
    else if (a.type === 'tf' && response.type === 'tf') correct = a.value === response.value
    else if (a.type === 'numeric' && response.type === 'numeric')
      correct = Math.abs(response.value - a.value) <= Math.abs(a.value) * a.tolerance
    else if (a.type === 'multi' && response.type === 'multi') {
      const right = response.indices.filter((i) => a.correctIndices.includes(i)).length
      const wrong = response.indices.length - right
      score = Math.max(0, (right - wrong) / a.correctIndices.length)
      correct = score === 1
    } else if (a.type === 'short' && response.type === 'short') {
      score = response.text.trim().length > 20 ? 0.5 : 0
      correct = false
    }
    if (a.type !== 'multi' && a.type !== 'short') score = correct ? 1 : 0
    return {
      questionId: q.id,
      correct,
      score,
      feedback: correct ? 'Correct.' : 'Not quite.',
      missingPoints: [],
      correctAnswer: q.explanation
    }
  }

  // ---------------------------------------------------------------- planner

  const planTopics = (d: DocState): PlanTopic[] =>
    topicsOf(d)
      .filter((t) => t.parentId === null && t.estimates)
      .map((t) => ({
        id: t.id,
        title: t.title,
        examWeight: t.estimates?.examWeight ?? 0,
        coreFraction: t.estimates?.coreFraction ?? 0,
        coreMinutes: t.estimates?.coreMinutes ?? 0,
        fullMinutes: t.estimates?.fullMinutes ?? 0,
        prerequisites: [],
        mastery: t.mastery === null ? null : { alpha: t.mastery * 10, beta: (1 - t.mastery) * 10 },
        minutesSpent: 0
      }))

  const buildPlan = (d: DocState, input: IpcInput<'plan.save'>['input']): ExamPlan => {
    const topics = planTopics(d)
    const budget = (input.totalHours ?? (input.hoursPerDay ?? 2) * 7) * 60
    let used = 0
    const items = topics.map((t) => {
      const level = used + t.coreMinutes <= budget ? ('core' as const) : ('skip' as const)
      if (level === 'core') used += t.coreMinutes
      return {
        topicId: t.id,
        level,
        minutes: level === 'core' ? t.coreMinutes : 0,
        expectedMarks: level === 'core' ? t.examWeight * t.coreFraction * 0.8 : 0,
        reason: level === 'core' ? 'Essentials fit the time budget' : 'Skipped: no time left in the budget',
        forcedBy: null
      }
    })
    const expectedScore = items.reduce((s, i) => s + i.expectedMarks, 0)
    const day: StudyDay = {
      date: now().toISOString(),
      totalMinutes: Math.min(120, used),
      sessions: items
        .filter((i) => i.level !== 'skip')
        .slice(0, 2)
        .map((i) => ({
          kind: 'learn',
          topicId: i.topicId,
          minutes: i.minutes,
          level: i.level,
          label: 'Learn the essentials'
        }))
    }
    return {
      id: nextId('plan'),
      docId: d.spec.id,
      input,
      result: {
        feasible: expectedScore >= input.targetScore,
        expectedScore,
        targetScore: input.targetScore,
        budgetMinutes: budget,
        reserveMinutes: 0,
        plannedMinutes: used,
        items,
        notes: []
      },
      schedule: { days: [day] },
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    }
  }

  const scopeDoc = (scope: Scope): DocState => getDoc(scope.docId)

  // ---------------------------------------------------------------- handlers

  const handlers: Handlers = {
    'app.info': () => ({ version: '0.1.0-web', platform: 'browser', dataDir: '(in memory)' }),

    'library.list': () =>
      [...docs.values()]
        .map(summary)
        .sort((a, b) => (b.lastOpenedAt ?? b.importedAt).localeCompare(a.lastOpenedAt ?? a.importedAt)),
    'library.import': ({ paths }) => {
      const names = paths ?? ['Thermodynamics, week 3.pdf']
      const created = names.map((path, i) => {
        const title = (path.split(/[\\/]/).pop() ?? path).replace(/\.pdf$/i, '')
        const existing = [...docs.values()].find((d) => d.title === title)
        if (existing) return summary(existing)
        const spec: BookSpec = {
          ...(BOOKS[2] ?? BOOKS[0]),
          id: nextId('doc'),
          title,
          pageCount: 40 + ((title.length * 7 + i * 13) % 80),
          importedDaysAgo: 0,
          openedDaysAgo: null,
          lastPage: 1,
          examInDays: null,
          indexedThrough: 0,
          topicsBuilt: false,
          cardsDue: 0
        } as BookSpec
        const state = initialState(spec, now())
        state.indexState = 'running'
        docs.set(spec.id, state)
        emit('library.changed', { docId: spec.id })
        return summary(state)
      })
      return created
    },
    'library.get': ({ docId }) => {
      const d = getDoc(docId)
      d.lastOpenedAt = now().toISOString()
      const detail: DocumentDetail = {
        ...summary(d),
        language: d.spec.language,
        outline: d.spec.topics.map((t) => ({ title: t.title, page: t.from, children: [] }))
      }
      return detail
    },
    'library.rename': ({ docId, title }) => {
      const d = getDoc(docId)
      d.title = title
      return summary(d)
    },
    'library.delete': ({ docId }) => {
      getDoc(docId)
      docs.delete(docId)
      return { deleted: true }
    },
    'library.setLastPage': ({ docId, page }) => {
      getDoc(docId).lastPage = page
      return { ok: true }
    },
    'library.search': ({ query, docId, limit }) => {
      const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
      const hits: SearchHit[] = []
      for (const d of docs.values()) {
        if (docId && d.spec.id !== docId) continue
        for (let page = 1; page <= d.spec.pageCount; page++) {
          const text = pageText(d.spec, page)
          const lower = text.toLowerCase()
          if (!terms.every((t) => lower.includes(t))) continue
          const at = lower.indexOf(terms[0] ?? '')
          const from = Math.max(0, at - 50)
          const snippet = `${from > 0 ? '…' : ''}${text.slice(from, at + 110).trim()}…`
          hits.push({ docId: d.spec.id, page, snippet, score: terms.length / (1 + page / 1000) })
        }
      }
      // Repeated slide templates produce duplicate snippets; keep the first page of each.
      const seen = new Set<string>()
      return hits
        .filter((h) => {
          const k = `${h.docId}:${h.snippet}`
          if (seen.has(k)) return false
          seen.add(k)
          return true
        })
        .slice(0, limit)
    },
    'library.pageNotes': ({ docId, page }) => notes(getDoc(docId), page),

    'index.start': ({ docId }) => {
      const d = getDoc(docId)
      if (d.indexState !== 'done') d.indexState = d.queue.length ? 'running' : 'done'
      return indexStatus(d)
    },
    'index.pause': ({ docId }) => {
      const d = getDoc(docId)
      if (d.indexState === 'running' || d.indexState === 'queued') d.indexState = 'paused'
      return indexStatus(d)
    },
    'index.status': ({ docId }) => indexStatus(getDoc(docId)),
    'index.focus': ({ docId, page }) => {
      const d = getDoc(docId)
      const start = Math.floor((page - 1) / CHUNK) * CHUNK + 1
      if (d.queue.includes(start)) d.queue = [start, ...d.queue.filter((s) => s !== start)]
      return { ok: true }
    },

    'topics.list': ({ docId }) => topicsOf(getDoc(docId)),
    'topics.rebuild': ({ docId }) => buildTopics(getDoc(docId)),

    'cards.generate': ({ scope }) => {
      const d = scopeDoc(scope)
      const job: JobInfo = {
        id: nextId('job'),
        kind: 'generate_cards',
        docId: d.spec.id,
        state: 'done',
        progress: 1,
        label: `Writing flashcards for ${d.title}`,
        error: null,
        attempts: 1,
        createdAt: now().toISOString(),
        updatedAt: now().toISOString()
      }
      upsertJob(job)
      emit('cards.changed', { docId: d.spec.id })
      return { jobId: job.id }
    },
    'cards.list': ({ scope, includeInactive }) =>
      scopeDoc(scope).cards.filter((c) => includeInactive || c.status === 'active'),
    'cards.due': ({ docId, limit }) =>
      [...docs.values()]
        .filter((d) => !docId || d.spec.id === docId)
        .flatMap((d) => d.cards)
        .filter((c) => c.status === 'active' && c.srs.due <= now().toISOString())
        .slice(0, limit),
    'cards.review': ({ cardId, rating }) => {
      const card = [...docs.values()].flatMap((d) => d.cards).find((c) => c.id === cardId)
      if (!card) throw new MockError('not_found', `Card ${cardId} not found`)
      card.srs = {
        ...card.srs,
        due: isoDaysFrom(now(), rating === 1 ? 0.01 : rating * 2),
        reps: card.srs.reps + 1,
        lapses: card.srs.lapses + (rating === 1 ? 1 : 0),
        state: rating === 1 ? 'relearning' : 'review',
        lastReview: now().toISOString()
      }
      emit('cards.changed', { docId: card.docId })
      return card
    },
    'cards.update': ({ cardId, front, back }) => {
      const card = [...docs.values()].flatMap((d) => d.cards).find((c) => c.id === cardId)
      if (!card) throw new MockError('not_found', `Card ${cardId} not found`)
      card.front = front
      card.back = back
      return card
    },
    'cards.setStatus': ({ cardId, status }) => {
      const card = [...docs.values()].flatMap((d) => d.cards).find((c) => c.id === cardId)
      if (!card) throw new MockError('not_found', `Card ${cardId} not found`)
      card.status = status
      return card
    },
    'cards.stats': ({ docId }) => {
      const cards = [...docs.values()].filter((d) => !docId || d.spec.id === docId).flatMap((d) => d.cards)
      const due = cards.filter((c) => c.srs.due <= now().toISOString()).length
      const count = (s: Card['srs']['state']): number => cards.filter((c) => c.srs.state === s).length
      return {
        due,
        new: count('new'),
        learning: count('learning'),
        review: count('review'),
        total: cards.length
      }
    },

    'quiz.create': ({ scope, mode, count, timeLimit }) => {
      const d = scopeDoc(scope)
      const page = scope.kind === 'page' ? scope.page : scope.kind === 'range' ? scope.from : 13
      const questions = Array.from({ length: Math.ceil(count / 2) }, (_, i) =>
        pageQuestions(d, page + i)
      ).flat()
      const session: QuizSession = {
        id: nextId('quiz'),
        docId: d.spec.id,
        mode,
        scope,
        questions: questions.slice(0, count),
        createdAt: now().toISOString(),
        timeLimit
      }
      quizzes.set(session.id, session)
      return session
    },
    'quiz.pageCheck': ({ docId, page }) => {
      const d = getDoc(docId)
      const session: QuizSession = {
        id: nextId('quiz'),
        docId,
        mode: 'page_check',
        scope: { kind: 'page', docId, page },
        questions: pageQuestions(d, page),
        createdAt: now().toISOString(),
        timeLimit: null
      }
      quizzes.set(session.id, session)
      return session
    },
    'quiz.answer': ({ quizId, questionId, response }) => {
      const quiz = quizzes.get(quizId)
      const q = quiz?.questions.find((x) => x.id === questionId)
      if (!quiz || !q) throw new MockError('not_found', 'Question not found')
      const result = grade(q, response)
      answers.set(quizId, [...(answers.get(quizId) ?? []).filter((a) => a.questionId !== questionId), result])
      return result
    },
    'quiz.finish': ({ quizId }) => {
      const quiz = quizzes.get(quizId)
      if (!quiz) throw new MockError('not_found', 'Quiz not found')
      const attempts = answers.get(quizId) ?? []
      const score = attempts.reduce((s, a) => s + a.score, 0)
      const result: QuizResult = {
        quizId,
        score,
        maxScore: quiz.questions.length,
        attempts,
        perTopic: [{ topicId: null, score, maxScore: quiz.questions.length }],
        reviewPages: attempts.filter((a) => !a.correct).length ? (quiz.questions[0]?.sourcePages ?? []) : [],
        finishedAt: now().toISOString()
      }
      return result
    },
    'quiz.history': ({ docId, limit }) => {
      getDoc(docId)
      return [...quizzes.values()]
        .filter((q) => q.docId === docId && answers.has(q.id))
        .slice(0, limit)
        .map((q) => {
          const attempts = answers.get(q.id) ?? []
          return {
            quizId: q.id,
            score: attempts.reduce((s, a) => s + a.score, 0),
            maxScore: q.questions.length,
            attempts,
            perTopic: [],
            reviewPages: [],
            finishedAt: now().toISOString()
          }
        })
    },
    'quiz.reportQuestion': () => ({ ok: true }),

    'reading.track': ({ docId }) => {
      getDoc(docId)
      return { ok: true }
    },

    'plan.get': ({ docId }) => plans.get(docId) ?? null,
    'plan.topics': ({ docId }) => planTopics(getDoc(docId)),
    'plan.save': ({ docId, input }) => {
      const plan = buildPlan(getDoc(docId), {
        ...input,
        overrides: input.overrides.map((o) => ({ ...o }))
      })
      plans.set(docId, plan)
      return plan
    },
    'plan.today': ({ docId }) => plans.get(docId)?.schedule.days[0] ?? null,

    'settings.get': () => settings,
    'settings.update': (patch) => {
      settings = { ...settings, ...patch }
      return settings
    },
    'settings.setApiKey': ({ apiKey }) => {
      settings = { ...settings, hasApiKey: apiKey !== null }
      return settings
    },
    'ai.health': ({ provider }) => ({
      ok: true,
      provider: provider ?? settings.provider,
      model: 'mock',
      latencyMs: 42,
      message: 'Mock provider is always healthy'
    }),

    'jobs.list': ({ docId }) =>
      [...jobs.values()].filter(
        (j) =>
          (!docId || j.docId === docId) &&
          (j.state === 'running' || j.state === 'queued' || j.state === 'paused')
      ),
    'jobs.cancel': ({ jobId }) => {
      const job = jobs.get(jobId)
      if (job) {
        upsertJob({ ...job, state: 'cancelled', updatedAt: now().toISOString() })
        const d = job.docId ? docs.get(job.docId) : undefined
        if (d && job.kind === 'index_chunk') {
          d.indexState = 'paused'
          indexJobs.delete(d.spec.id)
          emit('index.progress', { docId: d.spec.id, status: indexStatus(d) })
        }
      }
      return { ok: true }
    },
    'usage.summary': () => ({
      notional: true,
      todayUsd: 0.42,
      monthUsd: 6.1,
      byTask: [
        { task: 'index', usd: 4.2, calls: 61 },
        { task: 'cards', usd: 1.9, calls: 12 }
      ]
    })
  }

  const wait = (): Promise<void> => {
    const [lo, hi] = latency
    const ms = lo + Math.random() * (hi - lo)
    return ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve()
  }

  async function invoke<C extends IpcChannel>(
    channel: C,
    input: IpcInput<C>
  ): Promise<IpcEnvelope<IpcOutput<C>>> {
    await wait()
    const parsed = ipcContract[channel].input.safeParse(input)
    if (!parsed.success) return { ok: false, error: { kind: 'validation', message: parsed.error.message } }
    try {
      const handler: (input: IpcInput<C>) => IpcOutput<C> | Promise<IpcOutput<C>> = handlers[channel]
      return { ok: true, data: await handler(input) }
    } catch (e) {
      if (e instanceof MockError) return { ok: false, error: { kind: e.kind, message: e.message } }
      return { ok: false, error: { kind: 'internal', message: e instanceof Error ? e.message : String(e) } }
    }
  }

  return {
    invoke,
    on: (event, listener) => {
      listeners[event].add(listener)
      return () => {
        listeners[event].delete(listener)
      }
    },
    emit,
    pathForFile: (file) => file.name,
    pdfSource: async (docId) => {
      const d = getDoc(docId)
      let bytes = pdfCache.get(docId)
      if (!bytes) {
        bytes = makeBookPdf(d.spec)
        pdfCache.set(docId, bytes)
      }
      // pdf.js transfers (detaches) the buffer it is given, so hand out a copy.
      return { kind: 'data', data: (await bytes).slice() }
    },
    rateLimit: (minutes) => {
      const resetAt = new Date(now().getTime() + minutes * 60_000).toISOString()
      emit('ai.rateLimited', { resetAt, message: 'Claude usage limit reached' })
      setTimeout(() => emit('ai.rateLimited', null), minutes * 60_000)
    },
    dispose: () => {
      for (const t of timers) clearInterval(t)
      timers.clear()
    }
  }
}

/** Every channel in the contract, for the completeness test. */
export const contractChannels = Object.keys(ipcContract) as IpcChannel[]
