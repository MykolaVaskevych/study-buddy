import type { QuestionType } from '@shared/domain'
import { FOCUS_PAGES_KEY, formatRange, headerLines } from './common'
import { ALL_QUESTION_TYPES } from './questions'
import { STUDY_SYSTEM } from './study'

/**
 * Blind answer-key check (smart tier, low effort). The model answers the questions itself from
 * the same PDFs; it never sees the key, explanation or evidence. Same system prompt as
 * generation so the documents are read from the prompt cache.
 */

export const VERIFY_SYSTEM = STUDY_SYSTEM

/** What the verifier may see of a question: no key, no explanation, no evidence. */
export interface BlindQuestion {
  id: string
  type: QuestionType
  stem: string
  options: readonly string[] | null
}

const RULES = `Answer each question below yourself, using only the attached pages. You do not see any answer key.
For each question output one entry with its id:
- mcq: choice_index (0-based index of the single correct option).
- multi: choice_indices (0-based indices of all correct options).
- tf: tf_answer.
- numeric: numeric_value in the unit the question asks for.
Fields that do not belong to the question's type are null.
answerable: false if the pages do not determine one correct answer, or the question is ambiguous, flawed or has no correct option; then the answer fields may be null.
Think carefully and compute numeric answers step by step before answering.`

export function formatBlindQuestion(q: BlindQuestion): string {
  const options = (q.options ?? []).map((o, i) => `[${i}] ${o.replace(/\s+/g, ' ').trim()}`)
  return [`<question id="${q.id}" type="${q.type}">`, q.stem.trim(), ...options, '</question>'].join('\n')
}

/** Inverse of `formatBlindQuestion`, used by the fake provider. */
export function parseBlindQuestions(text: string): BlindQuestion[] {
  const out: BlindQuestion[] = []
  const pattern = /<question id="([^"]+)" type="(mcq|multi|tf|short|numeric)">\n([\s\S]*?)\n<\/question>/g
  for (const match of text.matchAll(pattern)) {
    const [, id, type, body] = match
    const qType = ALL_QUESTION_TYPES.find((t) => t === type)
    if (id === undefined || qType === undefined || body === undefined) continue
    const lines = body.split('\n')
    const firstOption = lines.findIndex((l) => /^\[\d+\] /.test(l))
    const stemLines = firstOption === -1 ? lines : lines.slice(0, firstOption)
    const options = firstOption === -1 ? [] : lines.slice(firstOption).map((l) => l.replace(/^\[\d+\] /, ''))
    out.push({
      id,
      type: qType,
      stem: stemLines.join('\n'),
      options: options.length > 0 ? options : null
    })
  }
  return out
}

export function buildVerifyUser(
  range: { from: number; to: number },
  questions: readonly BlindQuestion[]
): string {
  return [
    headerLines({
      Task: 'verify',
      [FOCUS_PAGES_KEY]: formatRange(range.from, range.to),
      Count: questions.length
    }),
    RULES,
    questions.map(formatBlindQuestion).join('\n\n')
  ].join('\n\n')
}
