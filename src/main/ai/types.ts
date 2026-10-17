import type {
  CardType,
  ChatMode,
  ChatTurn,
  Concept,
  ExamSignal,
  Exercise,
  Formula,
  OutlineItem,
  PageKind,
  Question,
  QuestionAnswer,
  QuestionType,
  Verification
} from '@shared/domain'
import type { AiTask, LlmProvider, Usage } from '@shared/ai/provider'
import type { ChunkInfo } from '../library/types'

/**
 * AI module contract (owner: ai work package).
 * StudyAi turns pages into study material. It runs prompts through an LlmProvider, validates and
 * post-processes outputs (page mapping, grounding, dedupe, answer-key verification) and returns
 * clean drafts. It does NOT touch the database.
 */

/** Text-layer lookup used for grounding checks: absolute page -> text ('' if image-only). */
export type PageTextLookup = (page: number) => string

export interface IndexedPage {
  page: number
  kind: PageKind
  teachable: boolean
  summary: string
  keyPoints: string[]
  concepts: Concept[]
  formulas: Formula[]
  exercises: Exercise[]
  examSignals: ExamSignal[]
}

/** Compact per-page digest used for whole-document calls (topic map). */
export interface PageDigest {
  page: number
  kind: PageKind
  summary: string
  keyPoints: string[]
  conceptTerms: string[]
  formulaCount: number
  examSignals: ExamSignal[]
  charCount: number
  hasTextLayer: boolean
}

export interface TopicDraft {
  key: string
  parentKey: string | null
  title: string
  pageStart: number
  pageEnd: number
  objectives: string[]
  difficulty: number
  examWeight: number
  examWeightReasons: string[]
  coreFraction: number
  coreMinutes: number
  fullMinutes: number
  prerequisiteKeys: string[]
}

export interface CardDraft {
  type: CardType
  front: string
  back: string
  essential: boolean
  sourcePages: number[]
  evidence: string | null
  verification: Verification
}

export interface QuestionDraft {
  type: QuestionType
  stem: string
  options: string[] | null
  answer: QuestionAnswer
  explanation: string
  optionRationales: string[] | null
  difficulty: number
  sourcePages: number[]
  evidence: string | null
  verification: Verification
}

/** Material for a generation call: the chunk PDFs covering the scope plus what the index already knows. */
export interface GenerationContext {
  chunks: ChunkInfo[]
  /** Absolute inclusive page range to focus on (chunks may cover more). */
  pageFrom: number
  pageTo: number
  /** Index notes for pages in range (helps the model prioritise core concepts). */
  notes: IndexedPage[]
  pageText: PageTextLookup
  /** 'auto' or a language code/name for generated text. */
  language: string
  signal?: AbortSignal
}

export interface UsageRecord {
  task: AiTask
  model: string
  usage: Usage
}

export interface WithUsage<T> {
  value: T
  usage: UsageRecord[]
}

export interface StudyAi {
  readonly provider: LlmProvider

  /** Index one chunk. Output pages are validated to lie inside the chunk range; missing pages are reported. */
  indexChunk(input: {
    chunk: ChunkInfo
    pageText: PageTextLookup
    signal?: AbortSignal
  }): Promise<WithUsage<{ language: string; pages: IndexedPage[]; missingPages: number[] }>>

  /** Course map + exam estimates from page digests and the PDF outline (text-only call). */
  buildTopicMap(input: {
    title: string
    outline: OutlineItem[]
    pages: PageDigest[]
    language: string
    signal?: AbortSignal
  }): Promise<WithUsage<TopicDraft[]>>

  /** Flashcards, grounded and de-duplicated against existingFronts. */
  generateCards(
    ctx: GenerationContext,
    opts: { count: number; essentialsOnly: boolean; existingFronts: string[] }
  ): Promise<WithUsage<CardDraft[]>>

  /**
   * Questions, grounded, de-duplicated, and (if verify=true) checked by a blind second pass;
   * questions whose key the verifier contradicts are dropped.
   */
  generateQuestions(
    ctx: GenerationContext,
    opts: {
      count: number
      types: QuestionType[] | null
      purpose: 'page_check' | 'quiz' | 'mock'
      existingStems: string[]
      verify: boolean
    }
  ): Promise<WithUsage<QuestionDraft[]>>

  /** Grade a free-text answer against the model answer and rubric. */
  gradeShortAnswer(input: { question: Question; response: string; signal?: AbortSignal }): Promise<
    WithUsage<{
      score: number
      verdict: 'correct' | 'partial' | 'incorrect'
      feedback: string
      missingPoints: string[]
    }>
  >

  /** Streamed tutor answer grounded in the given pages, citing them as [p. N]. Ends with one 'done' event. */
  chat(input: ChatInput): AsyncIterable<ChatEvent>

  /** Maps a past exam paper's questions (with marks) to course topics by key. */
  mapPastPaper(input: {
    topics: { key: string; title: string; pageStart: number; pageEnd: number }[]
    paper: ChunkInfo[]
    language: string
    signal?: AbortSignal
  }): Promise<WithUsage<{ summary: string; marks: number; topicKey: string | null }[]>>
}

/** A page given to chat as context: its text layer plus what the index knows about it. */
export interface ChatContextPage {
  page: number
  text: string
  summary: string | null
  keyPoints: string[]
  formulas: string[]
}

export interface ChatInput {
  mode: ChatMode
  question: string
  history: ChatTurn[]
  pages: ChatContextPage[]
  /** The current page as a PDF (so diagrams and image-only slides are visible), if any. */
  focus: ChunkInfo | null
  language: string
  signal?: AbortSignal
}

export type ChatEvent = { type: 'text'; text: string } | { type: 'done'; usage: UsageRecord }
