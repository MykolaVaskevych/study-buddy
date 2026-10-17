import type { QuestionType } from '@shared/domain'
import type { GenerationContext } from '../types'
import { FOCUS_PAGES_KEY, formatRange, headerLines, languageInstruction } from './common'
import { formatManifest, manifestEntries } from './manifest'
import { formatNotes } from './notes'
import { STUDY_SYSTEM } from './study'

/** Questions for page checks, topic quizzes and mock exams (smart tier). */

export const QUESTIONS_SYSTEM = STUDY_SYSTEM

export const ALL_QUESTION_TYPES: readonly QuestionType[] = ['mcq', 'multi', 'tf', 'short', 'numeric']

const MAX_LISTED_EXISTING = 40

export type QuestionPurpose = 'page_check' | 'quiz' | 'mock'

const PURPOSE: Record<QuestionPurpose, string> = {
  page_check:
    'Purpose: a quick check right after the student read these pages. Easy to medium (difficulty 1-3), each answerable in about a minute. Test the central ideas of the pages, not side remarks.',
  quiz: 'Purpose: a topic quiz. Mix difficulties (1-4) and cover the topic broadly, with an emphasis on core concepts and typical calculations.',
  mock: 'Purpose: a mock exam. Exam style and exam difficulty (mostly 3-5): multi-step reasoning, calculations with realistic values, applying concepts to new situations. Mirror any exam signals (practice exam questions, quiz slides, worked examples) in the notes.'
}

const RULES = `Question rules:
- Each question has a type and fills only the answer fields of that type; every other answer field is null:
  - mcq: options (3-6), correct_index (0-based), option_rationales (one per option: why it is right or wrong).
  - multi: options (3-6), correct_indices (0-based, at least one), option_rationales (one per option).
  - tf: tf_answer (true or false); options null.
  - short: model_answer (a complete answer in 1-4 sentences) and rubric (2-5 independently gradable points).
  - numeric: numeric_value, numeric_tolerance (relative, e.g. 0.02 means plus or minus 2 %), numeric_unit (null when dimensionless). Give all needed values in the stem; the answer must follow from the pages with a calculator.
- Prefer questions that test understanding and calculation over recall of wording.
- Distractors are plausible (typical misconceptions, sign or unit errors, confusing related concepts), similar in length and style to the correct option, and clearly wrong for a student who understood the page. Never use "all of the above" or "none of the above". No giveaway wording.
- The correct option position varies across questions.
- A true/false statement is unambiguously true or false according to the pages.
- difficulty: integer 1 (recall) to 5 (multi-step reasoning).
- explanation: why the answer is right, referring to the idea on the page (2-4 sentences).
- Do not repeat questions listed under "Already asked".
- source_pages: the page-stamp numbers the question is based on, all inside the focus pages.
- evidence: a verbatim quote (at most 25 words) copied from the text of a source page that supports the answer. If the source page is image-only, briefly describe the figure instead.`

export function buildQuestionsUser(
  ctx: GenerationContext,
  opts: {
    count: number
    types: readonly QuestionType[] | null
    purpose: QuestionPurpose
    existingStems: readonly string[]
  }
): string {
  const types = opts.types === null || opts.types.length === 0 ? ALL_QUESTION_TYPES : opts.types
  const existing = opts.existingStems.slice(0, MAX_LISTED_EXISTING)
  return [
    headerLines({
      Task: 'questions',
      [FOCUS_PAGES_KEY]: formatRange(ctx.pageFrom, ctx.pageTo),
      Count: opts.count,
      Types: types.join(', '),
      Purpose: opts.purpose
    }),
    `Write ${opts.count} questions for pages ${ctx.pageFrom}-${ctx.pageTo}, using only these types: ${types.join(', ')}. The attached chunks may contain other pages: ignore them.`,
    PURPOSE[opts.purpose],
    languageInstruction(ctx.language),
    RULES,
    formatManifest(manifestEntries(ctx.pageFrom, ctx.pageTo, ctx.pageText, 0)),
    formatNotes(ctx.notes),
    existing.length > 0
      ? ['Already asked (do not repeat):', ...existing.map((s) => `- ${s.replace(/\s+/g, ' ').trim()}`)].join(
          '\n'
        )
      : 'Already asked: nothing yet.'
  ].join('\n\n')
}
