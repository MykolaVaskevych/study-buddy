import type { Annotation, ExamProfile, Lesson } from '@shared/domain'
import { cramMinutes, cramQuestionCount, cramQuestionTypes } from '@shared/cram'
import { createMockCourses } from './mock-courses'
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
  Card,
  DocumentDetail,
  DocumentSummary,
  IndexStatus,
  JobInfo,
  PageNotes,
  SearchHit,
  Topic
} from '@shared/domain'
import type { ClaudeAccount } from '@shared/ai/connections'
import type { PublicSettings } from '@shared/settings'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { ExamPlan, PlanTopic } from '@shared/planner/types'
import { buildSchedule, solvePlan } from '@shared/planner'
import { BOOKS, flattenTopics, pageText, slideFor } from './mock-data'
import type { BookSpec } from './mock-data'
import { makeBookPdf } from './mock-pdf'
import { createStudyHandlers, makeCards } from './mock-study'
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

/** The local calendar day of `d` as YYYY-MM-DD (the planner counts days in the student's time zone). */
const localDay = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

/** A YYYY-MM-DD day as an ISO timestamp at local noon, so every time zone reads the same day back. */
const dayToIso = (day: string): string => {
  const [y = 1970, m = 1, dd = 1] = day.split('-').map(Number)
  return new Date(y, m - 1, dd, 12).toISOString()
}

function chunkStarts(pageCount: number, done: (p: number) => boolean): number[] {
  const out: number[] = []
  for (let p = 1; p <= pageCount; p += CHUNK) if (!done(p)) out.push(p)
  return out
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
  const plans = new Map<string, ExamPlan>()
  const pdfCache = new Map<string, Promise<Uint8Array>>()
  const timers = new Set<ReturnType<typeof setInterval>>()
  let settings: PublicSettings = { ...DEFAULT_SETTINGS, hasApiKey: false, hasOpenAiCompatibleKey: false }
  let claudeAccount: ClaudeAccount = {
    installed: true,
    loggedIn: true,
    method: 'claude.ai',
    email: 'student@example.com',
    plan: 'pro',
    problem: null
  }
  let seq = 0
  const annotations: Annotation[] = []
  const profiles = new Map<string, ExamProfile>()
  const profileOf = (docId: string): ExamProfile =>
    profiles.get(docId) ?? {
      docId,
      formats: { mcq: 0.4, written: 0.3, numeric: 0.3 },
      formulas: 'apply',
      formulaSheet: false,
      style: '',
      examples: [],
      source: 'default',
      updatedAt: null
    }
  const nextId = (prefix: string): string => `${prefix}-${++seq}`

  const listeners: { [E in IpcEvent]: Set<(payload: IpcEvents[E]) => void> } = {
    'jobs.changed': new Set(),
    'index.progress': new Set(),
    'library.changed': new Set(),
    'cards.changed': new Set(),
    'pageCheck.ready': new Set(),
    'ai.rateLimited': new Set(),
    'chat.delta': new Set(),
    'chat.done': new Set()
  }
  const emit = <E extends IpcEvent>(event: E, payload: IpcEvents[E]): void => {
    for (const l of listeners[event]) l(payload)
  }

  const getDoc = (docId: string): DocState => {
    const d = docs.get(docId)
    if (!d) throw new MockError('not_found', `Document ${docId} not found`)
    return d
  }
  const courses = createMockCourses(BOOKS, {
    nextId,
    titleOf: (docId) => getDoc(docId).title,
    fail: (message) => {
      throw new MockError('not_found', message)
    },
    changed: () => emit('library.changed', { docId: null })
  })

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
        prerequisites: (spec.prerequisites ?? []).map((title) => `${d.spec.id}:${title}`)
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

  // ---------------------------------------------------------------- flashcards & quizzes

  const study = createStudyHandlers({
    docs,
    now,
    nextId,
    emit,
    upsertJob,
    fail: (kind, message) => {
      throw new MockError(kind, message)
    },
    later: (fn, ms) => {
      if (simulate) setTimeout(fn, ms)
      else fn()
    },
    simulate
  })

  // ---------------------------------------------------------------- planner

  /** The units of study are the leaf topics; chapters only group them (via parentId in topics.list). */
  const planTopics = (d: DocState): PlanTopic[] => {
    const all = topicsOf(d)
    const parents = new Set(all.map((t) => t.parentId))
    return all
      .filter((t) => !parents.has(t.id) && t.estimates)
      .map((t) => ({
        id: t.id,
        title: t.title,
        examWeight: t.estimates?.examWeight ?? 0,
        coreFraction: t.estimates?.coreFraction ?? 0,
        coreMinutes: t.estimates?.coreMinutes ?? 0,
        fullMinutes: t.estimates?.fullMinutes ?? 0,
        prerequisites: t.estimates?.prerequisites ?? [],
        mastery: t.mastery === null ? null : { alpha: t.mastery * 10, beta: (1 - t.mastery) * 10 },
        minutesSpent: 0
      }))
  }

  /** Solves and schedules like main does: the same pure planner, counted from the local today. */
  const buildPlan = (d: DocState, input: IpcInput<'plan.save'>['input']): ExamPlan => {
    const topics = planTopics(d)
    const today = localDay(now())
    const result = solvePlan(topics, input, { today })
    const previous = plans.get(d.spec.id)
    return {
      id: previous?.id ?? nextId('plan'),
      docId: d.spec.id,
      input,
      result,
      schedule: buildSchedule(result, topics, input, today),
      createdAt: previous?.createdAt ?? now().toISOString(),
      updatedAt: now().toISOString()
    }
  }

  // The Signals book starts with a saved plan, so browser mode shows the Today widget.
  const seeded = docs.get('signals-systems')
  if (seeded?.topicsBuilt && seeded.examDate) {
    const input: IpcInput<'plan.save'>['input'] = {
      examDate: localDay(new Date(seeded.examDate)),
      totalHours: null,
      hoursPerDay: 2,
      targetScore: 0.7,
      mode: 'max_score',
      format: 'mixed',
      overrides: []
    }
    plans.set(seeded.spec.id, buildPlan(seeded, input))
  }

  // ---------------------------------------------------------------- handlers

  const handlers: Handlers = {
    'app.info': () => ({ version: '0.1.0-web', platform: 'browser', dataDir: '(in memory)' }),

    'library.list': () =>
      [...docs.values()]
        .map(summary)
        .sort((a, b) => (b.lastOpenedAt ?? b.importedAt).localeCompare(a.lastOpenedAt ?? a.importedAt)),
    'library.import': ({ paths, courseId }) => {
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
      const folder = names[0]?.split(/[\\/]/).slice(-2, -1)[0]
      courses.place(
        created.map((d) => d.id),
        courseId ?? null,
        folder ?? created[0]?.title ?? 'New course'
      )
      return created
    },
    ...courses.handlers,
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
      courses.removeDoc(docId)
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
      // Main prefetches the page check for the page being read; announce it like main would.
      if (simulate && settings.prefetchPageChecks && d.indexed[page - 1]) {
        setTimeout(() => emit('pageCheck.ready', { docId, page }), 1200)
      }
      return { ok: true }
    },

    'topics.list': ({ docId }) => topicsOf(getDoc(docId)),
    'topics.rebuild': ({ docId }) => buildTopics(getDoc(docId)),

    ...study,

    'reading.track': ({ docId }) => {
      getDoc(docId)
      return { ok: true }
    },

    'plan.get': ({ docId }) => plans.get(docId) ?? null,
    'plan.topics': ({ docId }) => planTopics(getDoc(docId)),
    'plan.save': ({ docId, input }) => {
      const d = getDoc(docId)
      const plan = buildPlan(d, {
        ...input,
        overrides: input.overrides.map((o) => ({ ...o }))
      })
      plans.set(docId, plan)
      d.examDate = input.examDate ? dayToIso(input.examDate) : null
      return plan
    },
    'plan.today': ({ docId }) => {
      const today = localDay(now())
      return plans.get(docId)?.schedule.days.find((day) => day.date === today) ?? null
    },

    'library.cheatSheet': ({ docId }) => {
      const d = getDoc(docId)
      return {
        docId,
        title: d.spec.title,
        sections: [
          {
            topicId: null,
            title: 'Power budget',
            pageStart: 12,
            pageEnd: 14,
            concepts: [
              {
                term: 'Attenuation',
                definition: 'Loss of optical power along the fibre, in dB/km.',
                importance: 'core'
              }
            ],
            formulas: [
              {
                latex: 'P_{rx} = P_{tx} - \\alpha L',
                meaning: 'Received power after a span of length L',
                symbols: [],
                importance: 'core'
              }
            ],
            keyFacts: ['Typical single-mode loss is 0.2 dB/km at 1550 nm.']
          }
        ]
      }
    },
    'cards.exportAnki': ({ docId }) => ({
      fileName: 'study-buddy-anki.txt',
      content: '#separator:tab\n#html:true\n#notetype column:1\n#deck column:2\n#tags column:5\n',
      count: docId === null ? 0 : 0
    }),
    'chat.ask': ({ page, question }) => {
      const requestId = nextId('chat')
      const words =
        `Here is what your notes say about "${question.slice(0, 60)}": the received power falls by the fibre loss times the length [p. ${page ?? 12}].`.split(
          ' '
        )
      words.forEach((w, i) =>
        setTimeout(() => emit('chat.delta', { requestId, text: `${w} ` }), 30 * (i + 1))
      )
      setTimeout(
        () => emit('chat.done', { requestId, error: null, citations: [page ?? 12] }),
        30 * (words.length + 2)
      )
      return { requestId }
    },
    'chat.cancel': () => ({ ok: true }),
    'plan.importPastPaper': () => ({ questionsMapped: 0, unmapped: 0, changes: [], profile: null }),
    'library.overview': ({ docId }) => {
      const d = getDoc(docId)
      const status = indexStatus(d)
      return {
        docId,
        title: d.spec.title,
        pageCount: d.spec.pageCount,
        index: status,
        topics: { state: status.state === 'done' ? 'ready' : 'waiting', count: 8 },
        plan: {
          saved: plans.has(docId),
          examDate: plans.get(docId)?.input.examDate ?? null,
          expectedScore: plans.get(docId)?.result.expectedScore ?? null
        },
        cards: { total: 12, due: 4, topicsCovered: 3, topicsTotal: 8 },
        questions: { total: 20, pageChecksReady: 5 },
        studyBook: { written: 2, topicsTotal: 8 },
        progress: { pagesRead: 14, minutesRead: 38, reviews: 9, quizzes: 1, mastery: 0.56 },
        jobs: [],
        preparing: false
      }
    },
    'library.prepare': ({ docId, force }) =>
      !force && !profiles.has(docId)
        ? { queued: 0, needsProfile: true, message: 'Tell Study Buddy what your exam looks like first.' }
        : { queued: 5, needsProfile: false, message: 'Making essentials flashcards for 5 topics.' },
    'exam.getProfile': ({ docId }) => profileOf(docId),
    'exam.saveProfile': ({ docId, formats, formulas, formulaSheet }) => {
      const sum = formats.mcq + formats.written + formats.numeric || 1
      const saved: ExamProfile = {
        docId,
        formats: { mcq: formats.mcq / sum, written: formats.written / sum, numeric: formats.numeric / sum },
        formulas,
        formulaSheet,
        style: '',
        examples: [],
        source: 'user',
        updatedAt: now().toISOString()
      }
      profiles.set(docId, saved)
      return saved
    },
    'cards.rebuildForExam': () => ({ suspended: 3, queued: 6 }),
    'cram.plan': ({ docId, cards, scopes }) => {
      const profile = profileOf(docId)
      const covered = scopes ?? [{ docId, topicIds: null }]
      const picked = covered
        .flatMap((s) => getDoc(s.docId).cards)
        .filter((c) => c.status === 'active' && (profile.formulas !== 'none' || c.type !== 'formula'))
        .slice(0, cards)
      const questionCount = cramQuestionCount(cards)
      const minutes = cramMinutes(picked.length, questionCount)
      return {
        docId,
        scopes: covered,
        cards: picked,
        questionCount,
        questionTypes: cramQuestionTypes(profile),
        minutes
      }
    },
    // The mock spans only the first file: enough for screens and tests.
    'cram.quiz': ({ scopes, count, types }) => {
      const first = scopes[0]
      if (!first) throw new MockError('validation', 'No files to quiz on')
      return study['quiz.create']({
        scope: { kind: 'document', docId: first.docId },
        mode: 'topic',
        count,
        types,
        timeLimit: null
      })
    },
    'progress.reset': () => ({ cards: 12, attempts: 4, readingPages: 14 }),
    'lessons.list': ({ docId }) => {
      const all = topicsOf(getDoc(docId))
      const leaf = all.find((t) => !all.some((c) => c.parentId === t.id))
      return leaf ? [mockLesson(docId, leaf.id)] : []
    },
    'lessons.generate': ({ topicId }) => ({ queued: topicId === null ? 6 : 1 }),
    'annotations.list': ({ docId }) => annotations.filter((a) => a.docId === docId),
    'annotations.save': ({ docId, page, kind, text }) => {
      const at = now().toISOString()
      const existing = annotations.find((a) => a.docId === docId && a.page === page && a.kind === kind)
      if (existing) {
        existing.text = text
        existing.updatedAt = at
        return { ...existing }
      }
      const created = { id: nextId('ann'), docId, page, kind, text, createdAt: at, updatedAt: at }
      annotations.push(created)
      return { ...created }
    },
    'annotations.delete': ({ docId, page, kind }) => {
      const i = annotations.findIndex((a) => a.docId === docId && a.page === page && a.kind === kind)
      if (i >= 0) annotations.splice(i, 1)
      return { ok: true }
    },
    'settings.get': () => settings,
    'settings.update': (patch) => {
      settings = { ...settings, ...patch }
      return settings
    },
    'settings.setApiKey': ({ apiKey, provider }) => {
      settings =
        provider === 'openai-compatible'
          ? { ...settings, hasOpenAiCompatibleKey: apiKey !== null }
          : { ...settings, hasApiKey: apiKey !== null }
      return settings
    },
    'ai.claudeAccount': () => claudeAccount,
    'ai.claudeLogin': () => ({ url: 'https://claude.com/cai/oauth/authorize?code=true&mock=1' }),
    'ai.claudeLoginCode': ({ code }) => {
      if (code.trim() === '') throw new Error('Sign-in failed: no code')
      claudeAccount = { ...claudeAccount, loggedIn: true, email: 'student@example.com', plan: 'pro' }
      return claudeAccount
    },
    'ai.claudeLoginCancel': () => ({ ok: true }),
    'ai.claudeLogout': () => {
      claudeAccount = { ...claudeAccount, loggedIn: false, method: null, email: null, plan: null }
      return claudeAccount
    },
    'ai.listModels': ({ baseUrl }) =>
      baseUrl.includes('11434')
        ? { models: ['gpt-oss:20b', 'qwen3.6:27b'], error: null }
        : {
            models: [],
            error: `Cannot reach the server at ${baseUrl} (ECONNREFUSED). Is the server running?`
          },
    'ai.health': ({ provider }) => {
      const id = provider ?? settings.provider
      if (id === 'anthropic-api' && !settings.hasApiKey) {
        return {
          ok: false,
          provider: id,
          model: null,
          latencyMs: null,
          message: 'No API key is saved. Add your key, then test again.'
        }
      }
      return {
        ok: true,
        provider: id,
        model: id === 'fake' ? 'fake' : settings.models[id].fast,
        latencyMs: id === 'claude-code' ? 1840 : 620,
        message:
          id === 'claude-code'
            ? 'Connected through Claude Code'
            : id === 'openai-compatible'
              ? 'Ollama reachable'
              : 'Connected to the Anthropic API'
      }
    },

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
      notional: settings.provider !== 'anthropic-api',
      todayUsd: 0.42,
      monthUsd: 6.1,
      byTask: [
        { task: 'index', usd: 3.05, calls: 61 },
        { task: 'cards', usd: 1.2, calls: 12 },
        { task: 'page_check', usd: 0.85, calls: 34 },
        { task: 'grade', usd: 0.6, calls: 22 },
        { task: 'topics', usd: 0.4, calls: 2 }
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

/** A short study-book chapter for browser mode and tests. */
function mockLesson(docId: string, topicId: string): Lesson {
  return {
    docId,
    topicId,
    sections: [
      { title: 'The idea', markdown: 'Received power is launch power minus every loss in dB [p. 12].' },
      { title: 'Every formula', markdown: '$$P_{rx} = P_{tx} - \\alpha L$$' }
    ],
    exercises: [{ question: 'A 50 km link at 0.2 dB/km: fibre loss?', answer: '$0.2 \\times 50 = 10$ dB' }],
    createdAt: '2026-10-18T09:00:00.000Z'
  }
}
