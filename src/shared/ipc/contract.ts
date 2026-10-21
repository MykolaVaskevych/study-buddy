import { z } from 'zod'
import type {
  ExamProfile,
  Lesson,
  Annotation,
  BookOverview,
  ResetResult,
  AttemptResult,
  Card,
  Course,
  CramPlan,
  NameSuggestions,
  PortalState,
  PortalAgentState,
  PortalDownload,
  CheatSheet,
  PastPaperResult,
  DocumentDetail,
  DocumentSummary,
  IndexStatus,
  IsoDate,
  JobInfo,
  PageNotes,
  QuizResult,
  QuizSession,
  RateLimitInfo,
  SearchHit,
  Topic,
  UsageSummary
} from '../domain'
import type { ClaudeAccount, ClaudeLoginStart, CodexAccount, CodexLoginStart } from '../ai/connections'
import type { HealthResult } from '../ai/provider'
import type { PublicSettings } from '../settings'
import { settingsSchema, providerIdSchema } from '../settings'
import type { ExamPlan, PlanTopic, StudyDay } from '../planner/types'

/**
 * Typed IPC contract between renderer and main.
 * - Every channel validates its input in main with the zod schema below.
 * - Handlers return an IpcEnvelope; the renderer client unwraps it and throws ApiError on failure.
 * Adding a channel: add it here, implement it in src/main/ipc, add it to the renderer mock api.
 */

const id = z.string().min(1)
const page = z.number().int().min(1)

export const scopeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('page'), docId: id, page }),
  z.object({ kind: z.literal('range'), docId: id, from: page, to: page }),
  z.object({ kind: z.literal('topic'), docId: id, topicId: id }),
  z.object({ kind: z.literal('document'), docId: id })
])

const ratingSchema = z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)])
const questionTypeSchema = z.enum(['mcq', 'multi', 'tf', 'short', 'numeric'])
const quizModeSchema = z.enum(['page_check', 'topic', 'mock', 'from_book', 'review_mistakes'])

export const questionResponseSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('mcq'), index: z.number().int().min(0) }),
  z.object({ type: z.literal('multi'), indices: z.array(z.number().int().min(0)) }),
  z.object({ type: z.literal('tf'), value: z.boolean() }),
  z.object({ type: z.literal('short'), text: z.string().max(5000) }),
  z.object({ type: z.literal('numeric'), value: z.number(), unit: z.string().nullable() })
])

const studyLevelSchema = z.enum(['skip', 'core', 'full'])

export const planInputSchema = z.object({
  examDate: z.string().nullable(),
  totalHours: z.number().positive().nullable(),
  hoursPerDay: z.number().positive().max(24).nullable(),
  targetScore: z.number().min(0).max(1),
  mode: z.enum(['max_score', 'min_time']),
  format: z.enum(['mcq', 'written', 'numeric', 'mixed']),
  overrides: z.array(
    z.object({
      topicId: id,
      level: studyLevelSchema.optional(),
      examWeight: z.number().min(0).max(1).optional()
    })
  ),
  reserveFraction: z.number().min(0).max(0.9).optional(),
  pace: z.number().min(0.5).max(2).optional()
})

const none = z.object({}).strict()
const courseName = z.string().trim().min(1).max(200)
const cramScope = z.object({ docId: id, topicIds: z.array(id).max(500).nullable() })
const portalBounds = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(0),
  height: z.number().int().min(0)
})

/** Declares a channel: input schema + output type. */
function route<O>() {
  return <I extends z.ZodType>(input: I) => ({ input, output: undefined as unknown as O })
}

export const ipcContract = {
  // ------------------------------------------------------------ app
  'app.info': route<{ version: string; platform: string; dataDir: string }>()(none),

  // ------------------------------------------------------------ library
  'library.list': route<DocumentSummary[]>()(none),
  /**
   * paths = null opens a native file picker. Returns the imported (or already present) docs. Files go
   * into `courseId` when given; otherwise several new files become one new course, a single file its own.
   */
  'library.import': route<DocumentSummary[]>()(
    z.object({ paths: z.array(z.string()).nullable(), courseId: id.nullable().optional() })
  ),
  'library.get': route<DocumentDetail>()(z.object({ docId: id })),
  'library.rename': route<DocumentSummary>()(z.object({ docId: id, title: z.string().min(1).max(200) })),
  'library.delete': route<{ deleted: true }>()(z.object({ docId: id })),
  'library.setLastPage': route<{ ok: true }>()(z.object({ docId: id, page })),
  'library.search': route<SearchHit[]>()(
    z.object({
      query: z.string().min(1).max(200),
      docId: id.nullable(),
      limit: z.number().int().min(1).max(100)
    })
  ),
  'library.pageNotes': route<PageNotes>()(z.object({ docId: id, page })),
  /** What the AI has prepared for a book and what the student has done (overview page). */
  'library.overview': route<BookOverview>()(z.object({ docId: id })),
  /**
   * "Prepare everything": read every page, build the course map, then essentials flashcards for
   * every topic the saved plan does not skip (all topics without a plan). Steps already done are skipped.
   */
  'library.prepare': route<{ queued: number; message: string; needsProfile: boolean }>()(
    z.object({ docId: id, force: z.boolean().optional() })
  ),
  /** Clears the student's progress for a topic (and its subtopics) or the whole book; AI content stays. */
  'progress.reset': route<ResetResult>()(z.object({ docId: id, topicId: id.nullable() })),
  /** What the book's exam looks like (stored, else derived from the plan's exam format). */
  'exam.getProfile': route<ExamProfile>()(z.object({ docId: id })),
  'exam.saveProfile': route<ExamProfile>()(
    z.object({
      docId: id,
      formats: z.object({ mcq: z.number().min(0), written: z.number().min(0), numeric: z.number().min(0) }),
      formulas: z.enum(['none', 'recognise', 'apply']),
      formulaSheet: z.boolean()
    })
  ),
  /**
   * Re-fits the flashcards to the exam profile: suspends cards that do not fit (e.g. formula cards
   * for an exam without formulas) and writes new essentials decks per topic.
   */
  'cards.rebuildForExam': route<{ suspended: number; queued: number }>()(z.object({ docId: id })),
  /** "Don't panic" cram: `cards` flashcards that matter most for the exam, then exam-style questions. */
  'cram.plan': route<CramPlan>()(
    z.object({
      docId: id,
      cards: z.number().int().min(5).max(30),
      /** Files and chapters to cover, e.g. weeks 5–7 of a course; default: the whole of `docId`. */
      scopes: z.array(cramScope).min(1).max(50).optional()
    })
  ),
  /** Exam-style questions across the cram's files or chapters; the AI tops up where too few are stored. */
  'cram.quiz': route<QuizSession>()(
    z.object({
      scopes: z.array(cramScope).min(1).max(50),
      count: z.number().int().min(1).max(30),
      types: z.array(questionTypeSchema).nullable()
    })
  ),
  /** Study-book chapters written so far. */
  'lessons.list': route<Lesson[]>()(z.object({ docId: id })),
  /** Writes (or rewrites) the chapter for a topic, or for every leaf topic without one (topicId null). */
  'lessons.generate': route<{ queued: number }>()(z.object({ docId: id, topicId: id.nullable() })),
  'annotations.list': route<Annotation[]>()(z.object({ docId: id })),
  /** Creates or replaces the page's bookmark or note. */
  'annotations.save': route<Annotation>()(
    z.object({ docId: id, page, kind: z.enum(['bookmark', 'note']), text: z.string().max(20_000) })
  ),
  'annotations.delete': route<{ ok: true }>()(
    z.object({ docId: id, page, kind: z.enum(['bookmark', 'note']) })
  ),
  /** Revision sheet from the index: core concepts and formulas per topic (no AI call). */
  'library.cheatSheet': route<CheatSheet>()(z.object({ docId: id })),

  // ------------------------------------------------------------ courses
  /** Courses (subjects) in sidebar order, each with its files in order. */
  'courses.list': route<Course[]>()(none),
  /** A new course from files, moved out of their old courses (emptied courses disappear). */
  'courses.create': route<Course>()(z.object({ name: courseName, docIds: z.array(id).min(1).max(500) })),
  'courses.rename': route<Course>()(z.object({ courseId: id, name: courseName })),
  /** Moves a file into a course at a position; also reorders files within a course. */
  'courses.moveDocument': route<Course[]>()(
    z.object({ docId: id, courseId: id, index: z.number().int().min(0) })
  ),
  /** AI names for the course and its files from what they contain (fast tier); renames nothing. */
  'courses.suggestNames': route<NameSuggestions>()(z.object({ courseId: id })),
  /** Splits a course back into one-file courses; no file is deleted. */
  'courses.dissolve': route<{ ok: true }>()(z.object({ courseId: id })),
  'courses.reorder': route<Course[]>()(z.object({ courseIds: z.array(id).max(1000) })),

  // ------------------------------------------------------------ study portal (in-app browser)
  /**
   * Shows the portal browser over `bounds` (window coordinates of the screen's placeholder) and sets
   * the course downloads go into. Opens the course's last portal page when nothing is loaded yet.
   */
  'portal.open': route<PortalState>()(z.object({ bounds: portalBounds, courseId: id.nullable() })),
  /** Hides the portal browser (it keeps its page and sign-in). */
  'portal.close': route<{ ok: true }>()(none),
  'portal.setBounds': route<{ ok: true }>()(z.object({ bounds: portalBounds })),
  'portal.setCourse': route<PortalState>()(z.object({ courseId: id.nullable() })),
  /** Opens an address typed by the student ("sulis.ul.ie" works; only http and https). */
  'portal.navigate': route<PortalState>()(z.object({ url: z.string().trim().min(1).max(2000) })),
  'portal.go': route<PortalState>()(z.object({ action: z.enum(['back', 'forward', 'reload', 'stop']) })),
  'portal.state': route<PortalState>()(none),
  /**
   * "Get files with AI": the AI clicks through the open portal page (expands modules, opens topics,
   * presses Download) and every file lands in the portal's course. Progress arrives as 'portal.agent'.
   */
  'portal.agentStart': route<PortalAgentState>()(z.object({ goal: z.string().trim().max(500).nullable() })),
  'portal.agentStop': route<PortalAgentState>()(none),
  'portal.agentState': route<PortalAgentState>()(none),
  /** Forgets every portal sign-in (cookies and storage of the portal browser). */
  'portal.signOut': route<{ ok: true }>()(none),

  // ------------------------------------------------------------ AI index pass
  'index.start': route<IndexStatus>()(z.object({ docId: id })),
  'index.pause': route<IndexStatus>()(z.object({ docId: id })),
  'index.status': route<IndexStatus>()(z.object({ docId: id })),
  /** Reader moved to this page: index nearby chunks first and maybe prefetch a page check. */
  'index.focus': route<{ ok: true }>()(z.object({ docId: id, page })),

  // ------------------------------------------------------------ topics
  'topics.list': route<Topic[]>()(z.object({ docId: id })),
  'topics.rebuild': route<{ jobId: string }>()(z.object({ docId: id })),

  // ------------------------------------------------------------ flashcards
  'cards.generate': route<{ jobId: string }>()(
    z.object({
      scope: scopeSchema,
      essentialsOnly: z.boolean(),
      count: z.number().int().min(1).max(60).nullable()
    })
  ),
  'cards.list': route<Card[]>()(z.object({ scope: scopeSchema, includeInactive: z.boolean() })),
  'cards.due': route<Card[]>()(z.object({ docId: id.nullable(), limit: z.number().int().min(1).max(500) })),
  'cards.review': route<Card>()(
    z.object({ cardId: id, rating: ratingSchema, elapsedMs: z.number().int().min(0) })
  ),
  'cards.update': route<Card>()(z.object({ cardId: id, front: z.string().min(1), back: z.string().min(1) })),
  'cards.setStatus': route<Card>()(
    z.object({ cardId: id, status: z.enum(['active', 'suspended', 'reported']) })
  ),
  /** nextDue: earliest due date among active cards not due yet; null when none (for "nothing due" screens). */
  'cards.stats': route<{
    due: number
    new: number
    learning: number
    review: number
    total: number
    nextDue: IsoDate | null
  }>()(z.object({ docId: id.nullable() })),

  // ------------------------------------------------------------ quizzes
  /** Resolves when the questions are ready (may take a while if they must be generated). */
  'quiz.create': route<QuizSession>()(
    z.object({
      scope: scopeSchema,
      mode: quizModeSchema,
      count: z.number().int().min(1).max(60),
      types: z.array(questionTypeSchema).nullable(),
      timeLimit: z.number().int().min(1).max(600).nullable()
    })
  ),
  /** "Test me" on a page: instant when prefetched. */
  'quiz.pageCheck': route<QuizSession>()(z.object({ docId: id, page })),
  'quiz.answer': route<AttemptResult>()(
    z.object({
      quizId: id,
      questionId: id,
      response: questionResponseSchema,
      elapsedMs: z.number().int().min(0)
    })
  ),
  'quiz.finish': route<QuizResult>()(z.object({ quizId: id })),
  'quiz.history': route<QuizResult[]>()(z.object({ docId: id, limit: z.number().int().min(1).max(200) })),
  'quiz.reportQuestion': route<{ ok: true }>()(z.object({ questionId: id, reason: z.string().max(500) })),

  /** Anki import file (tab-separated, Basic + Cloze note types, MathJax delimiters). */
  'cards.exportAnki': route<{ fileName: string; content: string; count: number }>()(
    z.object({ docId: id.nullable() })
  ),

  // ------------------------------------------------------------ chat
  /** Starts a streamed answer; text arrives as 'chat.delta' events, then one 'chat.done'. */
  'chat.ask': route<{ requestId: string }>()(
    z.object({
      docId: id,
      page: page.nullable(),
      question: z.string().max(4000),
      history: z
        .array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(20_000) }))
        .max(20),
      mode: z.enum(['chat', 'explain_simple', 'explain_exam', 'worked_example'])
    })
  ),
  'chat.cancel': route<{ ok: true }>()(z.object({ requestId: id })),

  // ------------------------------------------------------------ reading
  'reading.track': route<{ ok: true }>()(z.object({ docId: id, page, seconds: z.number().min(0).max(3600) })),

  // ------------------------------------------------------------ exam planner
  'plan.get': route<ExamPlan | null>()(z.object({ docId: id })),
  /** Inputs for running the pure solver in the renderer (live preview while editing). */
  'plan.topics': route<PlanTopic[]>()(z.object({ docId: id })),
  'plan.save': route<ExamPlan>()(z.object({ docId: id, input: planInputSchema })),
  'plan.today': route<StudyDay | null>()(z.object({ docId: id })),
  /** Maps past exam papers (paths = null opens a picker) to topics and recalibrates exam weights. */
  'plan.importPastPaper': route<PastPaperResult>()(
    z.object({ docId: id, paths: z.array(z.string()).nullable() })
  ),

  // ------------------------------------------------------------ settings & AI
  'settings.get': route<PublicSettings>()(none),
  'settings.update': route<PublicSettings>()(settingsSchema.partial()),
  /**
   * null removes the stored key. Stored encrypted with the OS keychain (safeStorage). `provider`
   * picks whose key: the Anthropic API (default) or the OpenAI-compatible server.
   */
  'settings.setApiKey': route<PublicSettings>()(
    z.object({
      apiKey: z.string().min(10).nullable(),
      provider: z.enum(['anthropic-api', 'openai-compatible']).default('anthropic-api')
    })
  ),
  'ai.health': route<HealthResult>()(z.object({ provider: providerIdSchema.nullable() })),
  /** Claude Code's login on this computer (`claude auth status`). */
  'ai.claudeAccount': route<ClaudeAccount>()(none),
  /** Starts a Claude Code sign-in: the browser opens; the page then shows a code for `ai.claudeLoginCode`. */
  'ai.claudeLogin': route<ClaudeLoginStart>()(z.object({ method: z.enum(['claudeai', 'console']) })),
  'ai.claudeLoginCode': route<ClaudeAccount>()(z.object({ code: z.string().max(2000) })),
  'ai.claudeLoginCancel': route<{ ok: true }>()(none),
  /** Signs Claude Code out on this computer, terminal included. */
  'ai.claudeLogout': route<ClaudeAccount>()(none),
  /** Codex (OpenAI's CLI, on a ChatGPT plan) on this computer. */
  'ai.codexAccount': route<CodexAccount>()(none),
  /** Starts a device sign-in: the page to open and the code to enter there. */
  'ai.codexLogin': route<CodexLoginStart>()(none),
  /** Resolves once the student entered the code (or the sign-in stopped), with the new state. */
  'ai.codexLoginWait': route<CodexAccount>()(none),
  'ai.codexLoginCancel': route<{ ok: true }>()(none),
  /** Signs Codex out on this computer (the terminal `codex` too). */
  'ai.codexLogout': route<CodexAccount>()(none),
  /** Models an OpenAI-compatible server offers; uses the stored key for that server, if any. */
  'ai.listModels': route<{ models: string[]; error: string | null }>()(
    z.object({ baseUrl: z.url({ protocol: /^https?$/ }) })
  ),

  // ------------------------------------------------------------ jobs & usage
  'jobs.list': route<JobInfo[]>()(z.object({ docId: id.nullable() })),
  'jobs.cancel': route<{ ok: true }>()(z.object({ jobId: id })),
  'usage.summary': route<UsageSummary>()(none)
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']
/** Input after zod parsing in main (defaults applied). */
export type IpcParsedInput<C extends IpcChannel> = z.output<IpcContract[C]['input']>

export type IpcErrorKind = 'validation' | 'not_found' | 'ai' | 'rate_limited' | 'conflict' | 'internal'

export type IpcEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error: { kind: IpcErrorKind; message: string; resetAt?: string | null } }

/** Events pushed from main to renderer. */
export interface IpcEvents {
  'jobs.changed': JobInfo
  'index.progress': { docId: string; status: IndexStatus }
  'library.changed': { docId: string | null }
  'cards.changed': { docId: string }
  /** The portal browser navigated, loaded or changed title. */
  'portal.changed': PortalState
  /** A file downloaded in the portal was imported (or why not). */
  'portal.downloaded': PortalDownload
  /** Progress of "Get files with AI". */
  'portal.agent': PortalAgentState
  'pageCheck.ready': { docId: string; page: number }
  'chat.delta': { requestId: string; text: string }
  /** error = null on success; citations = distinct [p. N] pages in the answer. */
  'chat.done': { requestId: string; error: string | null; citations: number[] }
  /** null = rate limit cleared. */
  'ai.rateLimited': RateLimitInfo | null
}
export type IpcEvent = keyof IpcEvents

/** Shape of window.api exposed by the preload script. */
export interface PreloadApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcEnvelope<IpcOutput<C>>>
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
  /**
   * Absolute path of a dropped file (Electron's sandbox hides `File.path`). Optional: bridges that
   * cannot resolve paths (tests, browser mode) leave it out and the renderer falls back to the picker.
   */
  pathForFile?(file: File): string
}

export { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX, PDF_SCHEME, pdfUrl } from './constants'
