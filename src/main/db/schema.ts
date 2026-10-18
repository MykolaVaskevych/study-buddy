import { sql } from 'drizzle-orm'
import {
  blob,
  foreignKey,
  index,
  integer,
  primaryKey,
  real,
  sqliteTable,
  text,
  uniqueIndex
} from 'drizzle-orm/sqlite-core'
import type {
  AttemptResult,
  CardType,
  Concept,
  ExamSignal,
  Exercise,
  Formula,
  IndexState,
  ItemStatus,
  JobKind,
  JobState,
  OutlineItem,
  PageKind,
  QuestionAnswer,
  QuestionType,
  QuizMode,
  QuizResult,
  Rating,
  Scope,
  SrsData,
  SrsState,
  TopicEstimates,
  Verification
} from '@shared/domain'
import type { PlanInput, PlanResult, Schedule } from '@shared/planner/types'
import type { AiTask } from '@shared/ai/provider'
import type { QuestionPurpose } from './types'

/**
 * Drizzle schema: the single source of truth for table shapes. `drizzle-kit generate` diffs it into
 * SQL under drizzle/, which is embedded into migrations.ts (see that file for the workflow).
 *
 * Conventions:
 * - Timestamps are ISO-8601 UTC strings (`Date#toISOString`), so lexical order == time order.
 * - Arrays/objects are JSON text columns typed with `$type`, parsed by drizzle on read.
 * - Everything that belongs to a document cascades on document delete; the usage ledger keeps its rows.
 * - FTS5 (`pages_fts`) is not expressible in drizzle; it lives in the custom migration 0001.
 *
 * Only type imports from @shared: drizzle-kit loads this file without the path aliases.
 */

const json = <T>(name: string) => text(name, { mode: 'json' }).$type<T>()
const bool = (name: string) => integer(name, { mode: 'boolean' })
const emptyJsonArray = sql`'[]'`

export const documents = sqliteTable('documents', {
  id: text('id').primaryKey(),
  sha256: text('sha256').notNull().unique(),
  title: text('title').notNull(),
  storedPath: text('stored_path').notNull(),
  pageCount: integer('page_count').notNull(),
  outline: json<OutlineItem[]>('outline').notNull(),
  language: text('language'),
  importedAt: text('imported_at').notNull(),
  lastOpenedAt: text('last_opened_at'),
  lastPage: integer('last_page').notNull().default(1),
  indexState: text('index_state').$type<IndexState>().notNull().default('none'),
  indexError: text('index_error')
})

/**
 * One row per PDF page. `id` is an INTEGER PRIMARY KEY (a stable rowid alias) because it doubles as
 * the FTS5 rowid; an implicit rowid could change on VACUUM and desync the index.
 */
export const pages = sqliteTable(
  'pages',
  {
    id: integer('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    label: text('label'),
    text: text('text').notNull(),
    charCount: integer('char_count').notNull(),
    hasTextLayer: bool('has_text_layer').notNull(),
    /** Set by saveIndex; null = the AI index pass has not processed this page yet. */
    indexedAt: text('indexed_at'),
    kind: text('kind').$type<PageKind>(),
    teachable: bool('teachable').notNull().default(false),
    summary: text('summary'),
    keyPoints: json<string[]>('key_points').notNull().default(emptyJsonArray),
    concepts: json<Concept[]>('concepts').notNull().default(emptyJsonArray),
    formulas: json<Formula[]>('formulas').notNull().default(emptyJsonArray),
    exercises: json<Exercise[]>('exercises').notNull().default(emptyJsonArray),
    examSignals: json<ExamSignal[]>('exam_signals').notNull().default(emptyJsonArray)
  },
  (t) => [uniqueIndex('pages_doc_page_uq').on(t.docId, t.page)]
)

export const chunks = sqliteTable(
  'chunks',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    index: integer('idx').notNull(),
    startPage: integer('start_page').notNull(),
    endPage: integer('end_page').notNull(),
    path: text('path').notNull(),
    bytes: integer('bytes').notNull()
  },
  (t) => [primaryKey({ columns: [t.docId, t.index] })]
)

export const topics = sqliteTable(
  'topics',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    parentId: text('parent_id'),
    /** The topic-map key the AI used; lets a rebuild carry mastery over to the "same" topic. */
    key: text('key').notNull(),
    order: integer('ord').notNull(),
    title: text('title').notNull(),
    pageStart: integer('page_start').notNull(),
    pageEnd: integer('page_end').notNull(),
    objectives: json<string[]>('objectives').notNull(),
    /** prerequisites inside are resolved topic ids. */
    estimates: json<TopicEstimates>('estimates'),
    /** Beta(alpha, beta) mastery belief; both null until the first evidence arrives. */
    masteryAlpha: real('mastery_alpha'),
    masteryBeta: real('mastery_beta')
  },
  (t) => [
    index('topics_doc_idx').on(t.docId),
    foreignKey({ columns: [t.parentId], foreignColumns: [t.id], name: 'topics_parent_fk' }).onDelete(
      'cascade'
    )
  ]
)

export const cards = sqliteTable(
  'cards',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    type: text('type').$type<CardType>().notNull(),
    front: text('front').notNull(),
    back: text('back').notNull(),
    essential: bool('essential').notNull(),
    sourcePages: json<number[]>('source_pages').notNull(),
    evidence: text('evidence'),
    verification: text('verification').$type<Verification>().notNull(),
    status: text('status').$type<ItemStatus>().notNull().default('active'),
    // SRS state is stored in columns (not JSON) so due-queries can use an index.
    due: text('due').notNull(),
    stability: real('stability').notNull(),
    difficulty: real('difficulty').notNull(),
    reps: integer('reps').notNull(),
    lapses: integer('lapses').notNull(),
    srsState: text('srs_state').$type<SrsState>().notNull(),
    lastReview: text('last_review'),
    elapsedDays: real('elapsed_days').notNull(),
    scheduledDays: real('scheduled_days').notNull(),
    learningSteps: integer('learning_steps').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('cards_doc_idx').on(t.docId), index('cards_due_idx').on(t.status, t.due)]
)

/** Review log: before/after snapshots allow undo and a later FSRS parameter optimisation. */
export const cardReviews = sqliteTable(
  'card_reviews',
  {
    id: integer('id').primaryKey(),
    cardId: text('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    rating: integer('rating').$type<Rating>().notNull(),
    reviewedAt: text('reviewed_at').notNull(),
    elapsedMs: integer('elapsed_ms').notNull(),
    srsBefore: json<SrsData>('srs_before').notNull(),
    srsAfter: json<SrsData>('srs_after').notNull()
  },
  (t) => [index('card_reviews_card_idx').on(t.cardId, t.reviewedAt)]
)

export const questions = sqliteTable(
  'questions',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    topicId: text('topic_id').references(() => topics.id, { onDelete: 'set null' }),
    type: text('type').$type<QuestionType>().notNull(),
    /** What the question was generated for; page checks are served only from 'page_check'. */
    purpose: text('purpose').$type<QuestionPurpose>().notNull().default('quiz'),
    stem: text('stem').notNull(),
    options: json<string[]>('options'),
    answer: json<QuestionAnswer>('answer').notNull(),
    explanation: text('explanation').notNull(),
    optionRationales: json<string[]>('option_rationales'),
    difficulty: real('difficulty').notNull(),
    sourcePages: json<number[]>('source_pages').notNull(),
    evidence: text('evidence'),
    verification: text('verification').$type<Verification>().notNull(),
    status: text('status').$type<ItemStatus>().notNull().default('active'),
    statusReason: text('status_reason'),
    fromBook: bool('from_book').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('questions_doc_idx').on(t.docId, t.purpose)]
)

export const quizzes = sqliteTable(
  'quizzes',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    mode: text('mode').$type<QuizMode>().notNull(),
    scope: json<Scope>('scope').notNull(),
    /** Ordered: the order the questions are presented in. */
    questionIds: json<string[]>('question_ids').notNull(),
    timeLimit: integer('time_limit'),
    createdAt: text('created_at').notNull(),
    finishedAt: text('finished_at'),
    result: json<QuizResult>('result')
  },
  (t) => [index('quizzes_doc_idx').on(t.docId, t.finishedAt)]
)

/** One row per (quiz, question): answering again inside the same quiz replaces the attempt. */
export const quizAttempts = sqliteTable(
  'quiz_attempts',
  {
    id: integer('id').primaryKey(),
    quizId: text('quiz_id')
      .notNull()
      .references(() => quizzes.id, { onDelete: 'cascade' }),
    questionId: text('question_id')
      .notNull()
      .references(() => questions.id, { onDelete: 'cascade' }),
    correct: bool('correct').notNull(),
    score: real('score').notNull(),
    result: json<AttemptResult>('result').notNull(),
    response: json<unknown>('response'),
    elapsedMs: integer('elapsed_ms').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [
    uniqueIndex('quiz_attempts_quiz_question_uq').on(t.quizId, t.questionId),
    index('quiz_attempts_question_idx').on(t.questionId, t.createdAt)
  ]
)

export const reading = sqliteTable(
  'reading',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    seconds: real('seconds').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.docId, t.page] })]
)

/** One plan per document; saving again keeps the id and createdAt. */
export const plans = sqliteTable('plans', {
  docId: text('doc_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  id: text('id').notNull().unique(),
  input: json<PlanInput>('input').notNull(),
  result: json<PlanResult>('result').notNull(),
  schedule: json<Schedule>('schedule').notNull(),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull()
})

export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    kind: text('kind').$type<JobKind>().notNull(),
    docId: text('doc_id').references(() => documents.id, { onDelete: 'cascade' }),
    payload: json<unknown>('payload'),
    priority: integer('priority').notNull().default(0),
    dedupeKey: text('dedupe_key'),
    state: text('state').$type<JobState>().notNull(),
    progress: real('progress').notNull().default(0),
    label: text('label').notNull(),
    error: text('error'),
    attempts: integer('attempts').notNull().default(0),
    runAfter: text('run_after'),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [
    index('jobs_runnable_idx').on(t.state, t.priority, t.createdAt),
    index('jobs_dedupe_idx').on(t.dedupeKey),
    index('jobs_doc_idx').on(t.docId)
  ]
)

/** Append-only AI usage ledger. Survives document deletion (doc_id set null) so spend stays correct. */
export const usage = sqliteTable(
  'usage',
  {
    id: integer('id').primaryKey(),
    task: text('task').$type<AiTask>().notNull(),
    model: text('model').notNull(),
    provider: text('provider').notNull(),
    docId: text('doc_id').references(() => documents.id, { onDelete: 'set null' }),
    inputTokens: integer('input_tokens').notNull(),
    outputTokens: integer('output_tokens').notNull(),
    cacheReadTokens: integer('cache_read_tokens').notNull(),
    cacheWriteTokens: integer('cache_write_tokens').notNull(),
    costUsd: real('cost_usd'),
    notional: bool('notional').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [index('usage_created_idx').on(t.createdAt)]
)

/** Key/value JSON. The 'app' row holds only the settings the user changed (merged over defaults). */
export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: json<Record<string, unknown>>('value').notNull()
})

/** Opaque, already-encrypted blobs (the caller encrypts with Electron safeStorage). */
export const secrets = sqliteTable('secrets', {
  name: text('name').primaryKey(),
  value: blob('value', { mode: 'buffer' }).notNull(),
  updatedAt: text('updated_at').notNull()
})

/** The student's own marks on pages: one bookmark and one note per page (text optional for bookmarks). */
export const annotations = sqliteTable(
  'annotations',
  {
    id: text('id').primaryKey(),
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    page: integer('page').notNull(),
    kind: text('kind').$type<'bookmark' | 'note'>().notNull(),
    text: text('text').notNull().default(''),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull()
  },
  (t) => [uniqueIndex('annotations_doc_page_kind').on(t.docId, t.page, t.kind)]
)

/** Study-book chapters the AI wrote, one per topic (rewritten in place when regenerated). */
export const lessons = sqliteTable(
  'lessons',
  {
    docId: text('doc_id')
      .notNull()
      .references(() => documents.id, { onDelete: 'cascade' }),
    topicId: text('topic_id')
      .notNull()
      .references(() => topics.id, { onDelete: 'cascade' }),
    sections: json<{ title: string; markdown: string }[]>('sections').notNull(),
    exercises: json<{ question: string; answer: string }[]>('exercises').notNull(),
    createdAt: text('created_at').notNull()
  },
  (t) => [primaryKey({ columns: [t.docId, t.topicId] })]
)

/** What each book's exam looks like (one row per document); see ExamProfile. */
export const examProfiles = sqliteTable('exam_profiles', {
  docId: text('doc_id')
    .primaryKey()
    .references(() => documents.id, { onDelete: 'cascade' }),
  profile: json<{
    formats: { mcq: number; written: number; numeric: number }
    formulas: 'none' | 'recognise' | 'apply'
    formulaSheet: boolean
    style: string
    examples: string[]
    source: 'user' | 'past_paper'
  }>('profile').notNull(),
  updatedAt: text('updated_at').notNull()
})
