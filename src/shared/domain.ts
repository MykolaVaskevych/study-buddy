/**
 * Domain model shared by main and renderer. Pure data types only.
 * Page numbers are always 1-based ABSOLUTE page numbers of the original PDF.
 * Dates are ISO-8601 strings so values cross IPC unchanged.
 */

export type DocId = string
export type TopicId = string
export type CourseId = string
export type CardId = string
export type QuestionId = string
export type QuizId = string
export type JobId = string
export type PlanId = string
export type IsoDate = string

// ---------------------------------------------------------------- documents

export type IndexState = 'none' | 'queued' | 'running' | 'paused' | 'done' | 'error'

export interface IndexStatus {
  state: IndexState
  indexedPages: number
  totalPages: number
  error?: string
}

export interface OutlineItem {
  title: string
  page: number | null
  children: OutlineItem[]
}

export interface DocumentSummary {
  id: DocId
  title: string
  pageCount: number
  importedAt: IsoDate
  lastOpenedAt: IsoDate | null
  lastPage: number
  index: IndexStatus
  cardsDue: number
  /** 0..1 averaged over topics with data, null if nothing studied yet. */
  mastery: number | null
  examDate: IsoDate | null
}

/** A subject or module (e.g. "Optical Networks"): any number of files studied together. */
export interface Course {
  id: CourseId
  name: string
  /** Files in the student's order. */
  docIds: DocId[]
}

/** AI-suggested names for a course and its files; nothing changes until the student accepts them. */
export interface NameSuggestions {
  courseId: CourseId
  name: string
  files: { docId: DocId; title: string }[]
}

export interface DocumentDetail extends DocumentSummary {
  outline: OutlineItem[]
  language: string | null
}

// ---------------------------------------------------------------- pages

export type PageKind = 'title' | 'toc' | 'content' | 'exercise' | 'answers' | 'references' | 'blank' | 'other'

export type Importance = 'core' | 'supporting' | 'detail'

export type ExamSignal =
  | 'quiz_slide'
  | 'exam_trap'
  | 'practice_exam'
  | 'formula_sheet'
  | 'worked_example'
  | 'slide_correction'
  | 'emphasis'

export interface Concept {
  term: string
  definition: string
  importance: Importance
}

export interface FormulaSymbol {
  symbol: string
  meaning: string
  unit: string | null
}

export interface Formula {
  /** LaTeX without surrounding $ delimiters. */
  latex: string
  meaning: string
  symbols: FormulaSymbol[]
  importance: Importance
}

export interface Exercise {
  question: string
  answer: string | null
}

export interface PageNotes {
  docId: DocId
  page: number
  label: string | null
  /** False until the AI index pass has processed this page. */
  indexed: boolean
  kind: PageKind | null
  teachable: boolean
  summary: string | null
  keyPoints: string[]
  concepts: Concept[]
  formulas: Formula[]
  exercises: Exercise[]
  examSignals: ExamSignal[]
}

export interface SearchHit {
  docId: DocId
  page: number
  /** Short excerpt with the match, plain text. */
  snippet: string
  score: number
}

// ---------------------------------------------------------------- topics

export interface TopicEstimates {
  /** 1 (easy) .. 5 (hard). */
  difficulty: number
  /** Expected share of exam marks, 0..1. Weights of a document sum to ~1. */
  examWeight: number
  examWeightReasons: string[]
  /** Share of this topic's marks reachable by studying only its essentials, 0..1. */
  coreFraction: number
  coreMinutes: number
  fullMinutes: number
  prerequisites: TopicId[]
}

export interface Topic {
  id: TopicId
  docId: DocId
  parentId: TopicId | null
  order: number
  title: string
  pageStart: number
  pageEnd: number
  objectives: string[]
  estimates: TopicEstimates | null
  /** 0..1 estimated mastery from quizzes and card recall; null if no data. */
  mastery: number | null
}

// ---------------------------------------------------------------- scope

export type Scope =
  | { kind: 'page'; docId: DocId; page: number }
  | { kind: 'range'; docId: DocId; from: number; to: number }
  | { kind: 'topic'; docId: DocId; topicId: TopicId }
  | { kind: 'document'; docId: DocId }

// ---------------------------------------------------------------- flashcards

/** basic/cloze = concepts, why = reasoning (cause, effect, trade-offs), mistake = from a wrong answer. */
export type CardType = 'basic' | 'cloze' | 'formula' | 'contrast' | 'why' | 'mistake'
export type Verification = 'verified' | 'unverified' | 'not_applicable'
export type ItemStatus = 'active' | 'suspended' | 'reported'

/** FSRS rating: 1 Again, 2 Hard, 3 Good, 4 Easy. */
export type Rating = 1 | 2 | 3 | 4

export type SrsState = 'new' | 'learning' | 'review' | 'relearning'

export interface SrsData {
  due: IsoDate
  stability: number
  difficulty: number
  reps: number
  lapses: number
  state: SrsState
  lastReview: IsoDate | null
  /** FSRS bookkeeping kept opaque to callers. */
  elapsedDays: number
  scheduledDays: number
  learningSteps: number
}

export interface Card {
  id: CardId
  docId: DocId
  topicId: TopicId | null
  type: CardType
  /** Markdown with $LaTeX$. For cloze cards, gaps are written as {{c1::answer}}. */
  front: string
  back: string
  /** Part of the essentials ("core") deck. */
  essential: boolean
  sourcePages: number[]
  evidence: string | null
  verification: Verification
  status: ItemStatus
  srs: SrsData
  createdAt: IsoDate
}

/**
 * "Don't panic": a short cram for an exam that is close. The flashcards worth most right now, then
 * a few exam-style questions in the types the exam profile allows.
 */
export interface CramPlan {
  docId: DocId
  cards: Card[]
  questionCount: number
  /** null = any type. */
  questionTypes: QuestionType[] | null
  /** Rough length of the whole session. */
  minutes: number
}

// ---------------------------------------------------------------- questions

export type QuestionType = 'mcq' | 'multi' | 'tf' | 'short' | 'numeric'

export type QuestionAnswer =
  | { type: 'mcq'; correctIndex: number }
  | { type: 'multi'; correctIndices: number[] }
  | { type: 'tf'; value: boolean }
  | { type: 'short'; modelAnswer: string; rubric: string[] }
  | {
      type: 'numeric'
      value: number
      /** Relative tolerance, e.g. 0.02 = ±2 %. */
      tolerance: number
      unit: string | null
    }

export type QuestionResponse =
  | { type: 'mcq'; index: number }
  | { type: 'multi'; indices: number[] }
  | { type: 'tf'; value: boolean }
  | { type: 'short'; text: string }
  | { type: 'numeric'; value: number; unit: string | null }

export interface Question {
  id: QuestionId
  docId: DocId
  topicId: TopicId | null
  type: QuestionType
  /** Markdown with $LaTeX$. */
  stem: string
  /** Present for mcq/multi. */
  options: string[] | null
  answer: QuestionAnswer
  explanation: string
  /** Same length as options for mcq/multi: why each option is right or wrong. */
  optionRationales: string[] | null
  difficulty: number
  sourcePages: number[]
  evidence: string | null
  verification: Verification
  status: ItemStatus
  /** Taken from the book's own exercises rather than generated. */
  fromBook: boolean
  createdAt: IsoDate
}

export interface AttemptResult {
  questionId: QuestionId
  correct: boolean
  /** 0..1, partial credit for multi/short. */
  score: number
  feedback: string | null
  missingPoints: string[]
  /** Human-readable correct answer, markdown. */
  correctAnswer: string
}

export type QuizMode = 'page_check' | 'topic' | 'mock' | 'from_book' | 'review_mistakes'

export interface QuizSession {
  id: QuizId
  docId: DocId
  mode: QuizMode
  scope: Scope
  questions: Question[]
  createdAt: IsoDate
  /** Minutes; null for untimed. */
  timeLimit: number | null
}

export interface QuizResult {
  quizId: QuizId
  score: number
  maxScore: number
  attempts: AttemptResult[]
  perTopic: { topicId: TopicId | null; score: number; maxScore: number }[]
  /** Pages worth re-reading, most important first. */
  reviewPages: number[]
  finishedAt: IsoDate
}

// ---------------------------------------------------------------- jobs & usage

export type JobKind =
  | 'index_chunk'
  | 'topic_map'
  | 'generate_cards'
  | 'generate_questions'
  | 'page_check'
  | 'verify_questions'
  | 'write_lesson'

export type JobState = 'queued' | 'running' | 'paused' | 'done' | 'failed' | 'cancelled'

export interface JobInfo {
  id: JobId
  kind: JobKind
  docId: DocId | null
  state: JobState
  /** 0..1 */
  progress: number
  label: string
  error: string | null
  attempts: number
  createdAt: IsoDate
  updatedAt: IsoDate
}

export interface UsageSummary {
  /** Notional cost when using the Claude subscription (not billed per token). */
  notional: boolean
  todayUsd: number
  monthUsd: number
  byTask: { task: string; usd: number; calls: number }[]
}

export interface RateLimitInfo {
  /** When the provider is expected to accept requests again; null if unknown. */
  resetAt: IsoDate | null
  message: string
}

// ---------------------------------------------------------------- chat, cheat sheet, past papers

/** chat = free question; the explain modes work on the current page. */
export type ChatMode = 'chat' | 'explain_simple' | 'explain_exam' | 'worked_example'

export interface ChatTurn {
  role: 'user' | 'assistant'
  text: string
}

export interface CheatSheetSection {
  topicId: TopicId | null
  title: string
  pageStart: number
  pageEnd: number
  concepts: Concept[]
  formulas: Formula[]
  keyFacts: string[]
}

/** One-page revision sheet built from the index (no AI call). */
export interface CheatSheet {
  docId: DocId
  title: string
  sections: CheatSheetSection[]
}

export interface PastPaperResult {
  questionsMapped: number
  unmapped: number
  /** The exam profile learnt from the paper (format mix, formula use, style, examples); null if nothing mapped. */
  profile: ExamProfile | null
  /** Exam-weight changes per topic, 0..1. */
  changes: { topicId: TopicId; title: string; before: number; after: number }[]
}

// ---------------------------------------------------------------- annotations, overview, progress

export type AnnotationKind = 'bookmark' | 'note'

/** The student's own bookmark or note on a page. */
export interface Annotation {
  id: string
  docId: DocId
  page: number
  kind: AnnotationKind
  text: string
  createdAt: IsoDate
  updatedAt: IsoDate
}

/** Where a book stands: what the AI has prepared and what the student has done. */
export interface BookOverview {
  docId: DocId
  title: string
  pageCount: number
  index: IndexStatus
  /** waiting = pages still being read; building = course map job running. */
  topics: { state: 'waiting' | 'building' | 'ready'; count: number }
  plan: { saved: boolean; examDate: IsoDate | null; expectedScore: number | null }
  cards: { total: number; due: number; topicsCovered: number; topicsTotal: number }
  questions: { total: number; pageChecksReady: number }
  /** Study-book chapters written, out of leaf topics. */
  studyBook: { written: number; topicsTotal: number }
  progress: {
    pagesRead: number
    minutesRead: number
    reviews: number
    quizzes: number
    mastery: number | null
  }
  /** Background work for this book right now. */
  jobs: JobInfo[]
  /** A "Prepare everything" request is still working through its steps. */
  preparing: boolean
}

export interface ResetResult {
  cards: number
  attempts: number
  readingPages: number
}

// ---------------------------------------------------------------- study book

export interface LessonSection {
  title: string
  /** Markdown with $LaTeX$ and [p. N] citations. */
  markdown: string
}

export interface LessonExercise {
  question: string
  answer: string
}

/** A study-book chapter the AI wrote for one topic: explanations, worked examples, traps, exercises. */
export interface Lesson {
  docId: DocId
  topicId: TopicId
  sections: LessonSection[]
  exercises: LessonExercise[]
  createdAt: IsoDate
}

// ---------------------------------------------------------------- exam profile

/** How the exam uses formulas: not at all, knowing what they mean, or calculating with them. */
export type FormulaUse = 'none' | 'recognise' | 'apply'

/** What the exam looks like; every generator (cards, questions, study book) follows it. */
export interface ExamProfile {
  docId: DocId
  /** Share of marks by question format, 0..1, summing to 1. */
  formats: { mcq: number; written: number; numeric: number }
  formulas: FormulaUse
  /** A formula sheet is provided in the exam: understand formulas, don't memorise them. */
  formulaSheet: boolean
  /** Short description of the exam's style (from a past paper), used in prompts. */
  style: string
  /** A few real past exam questions to imitate. */
  examples: string[]
  /** default = nothing known yet; user = set by the student; past_paper = learnt from a paper. */
  source: 'default' | 'user' | 'past_paper'
  updatedAt: IsoDate | null
}
