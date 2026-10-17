import { z } from 'zod'
import type {
  AttemptResult,
  Card,
  DocumentDetail,
  DocumentSummary,
  IndexStatus,
  JobInfo,
  PageNotes,
  QuizResult,
  QuizSession,
  RateLimitInfo,
  SearchHit,
  Topic,
  UsageSummary
} from '../domain'
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
  )
})

const none = z.object({}).strict()

/** Declares a channel: input schema + output type. */
function route<O>() {
  return <I extends z.ZodType>(input: I) => ({ input, output: undefined as unknown as O })
}

export const ipcContract = {
  // ------------------------------------------------------------ app
  'app.info': route<{ version: string; platform: string; dataDir: string }>()(none),

  // ------------------------------------------------------------ library
  'library.list': route<DocumentSummary[]>()(none),
  /** paths = null opens a native file picker. Returns the imported (or already present) docs. */
  'library.import': route<DocumentSummary[]>()(z.object({ paths: z.array(z.string()).nullable() })),
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
  'cards.stats': route<{ due: number; new: number; learning: number; review: number; total: number }>()(
    z.object({ docId: id.nullable() })
  ),

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

  // ------------------------------------------------------------ reading
  'reading.track': route<{ ok: true }>()(z.object({ docId: id, page, seconds: z.number().min(0).max(3600) })),

  // ------------------------------------------------------------ exam planner
  'plan.get': route<ExamPlan | null>()(z.object({ docId: id })),
  /** Inputs for running the pure solver in the renderer (live preview while editing). */
  'plan.topics': route<PlanTopic[]>()(z.object({ docId: id })),
  'plan.save': route<ExamPlan>()(z.object({ docId: id, input: planInputSchema })),
  'plan.today': route<StudyDay | null>()(z.object({ docId: id })),

  // ------------------------------------------------------------ settings & AI
  'settings.get': route<PublicSettings>()(none),
  'settings.update': route<PublicSettings>()(settingsSchema.partial()),
  /** null removes the stored key. Stored encrypted with the OS keychain (safeStorage). */
  'settings.setApiKey': route<PublicSettings>()(z.object({ apiKey: z.string().min(10).nullable() })),
  'ai.health': route<HealthResult>()(z.object({ provider: providerIdSchema.nullable() })),

  // ------------------------------------------------------------ jobs & usage
  'jobs.list': route<JobInfo[]>()(z.object({ docId: id.nullable() })),
  'jobs.cancel': route<{ ok: true }>()(z.object({ jobId: id })),
  'usage.summary': route<UsageSummary>()(none)
} as const

export type IpcContract = typeof ipcContract
export type IpcChannel = keyof IpcContract
export type IpcInput<C extends IpcChannel> = z.input<IpcContract[C]['input']>
export type IpcOutput<C extends IpcChannel> = IpcContract[C]['output']

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
  'pageCheck.ready': { docId: string; page: number }
  /** null = rate limit cleared. */
  'ai.rateLimited': RateLimitInfo | null
}
export type IpcEvent = keyof IpcEvents

/** Shape of window.api exposed by the preload script. */
export interface PreloadApi {
  invoke<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcEnvelope<IpcOutput<C>>>
  on<E extends IpcEvent>(event: E, listener: (payload: IpcEvents[E]) => void): () => void
}

export const IPC_INVOKE_PREFIX = 'sb:'
export const IPC_EVENT_PREFIX = 'sb-event:'

/** Custom protocol that serves stored PDFs to the viewer: sb-pdf://doc/<docId> */
export const PDF_SCHEME = 'sb-pdf'
export const pdfUrl = (docId: string): string => `${PDF_SCHEME}://doc/${encodeURIComponent(docId)}`
