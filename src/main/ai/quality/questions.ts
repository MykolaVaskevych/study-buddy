import type { QuestionAnswer, QuestionType } from '@shared/domain'
import type { QuestionsOutput } from '@shared/ai/schemas'
import { clamp, cleanStrings, normalizeText } from './text'

/**
 * Turns the flattened question fields of the structured output (one nullable field per answer
 * kind, because object unions are not allowed in output schemas) into the `QuestionAnswer`
 * union. Items whose fields contradict their type are dropped instead of repaired: a guessed
 * answer key is worse than a missing question.
 */

export type RawQuestion = QuestionsOutput['questions'][number]

/** A converted question before grounding (source pages and evidence are still raw). */
export interface ConvertedQuestion {
  type: QuestionType
  stem: string
  options: string[] | null
  answer: QuestionAnswer
  explanation: string
  optionRationales: string[] | null
  difficulty: number
  sourcePages: number[]
  evidence: string
}

export const OPTION_COUNT = { min: 3, max: 6 } as const
/** Relative tolerance used when a numeric question comes without one. */
export const DEFAULT_NUMERIC_TOLERANCE = 0.02
const MAX_NUMERIC_TOLERANCE = 0.5
const MAX_RUBRIC_POINTS = 8

/** Options must be 3..6 non-empty, mutually distinct strings. */
function validOptions(options: string[] | null): string[] | null {
  if (options === null) return null
  const trimmed = options.map((o) => o.trim())
  if (trimmed.length < OPTION_COUNT.min || trimmed.length > OPTION_COUNT.max) return null
  if (trimmed.some((o) => o === '')) return null
  if (new Set(trimmed.map(normalizeText)).size !== trimmed.length) return null
  return trimmed
}

function validIndex(index: number | null, length: number): index is number {
  return index !== null && Number.isInteger(index) && index >= 0 && index < length
}

/** Relative tolerance; values above 1 are read as percentages ("2" meaning 2 %). */
export function normalizeTolerance(raw: number | null): number {
  if (raw === null || !Number.isFinite(raw)) return DEFAULT_NUMERIC_TOLERANCE
  const relative = Math.abs(raw) > 1 ? Math.abs(raw) / 100 : Math.abs(raw)
  return clamp(relative, 0, MAX_NUMERIC_TOLERANCE, DEFAULT_NUMERIC_TOLERANCE)
}

function choiceAnswer(
  raw: RawQuestion,
  options: string[]
): { answer: QuestionAnswer; rationales: string[] | null } | null {
  const rationales =
    raw.option_rationales !== null && raw.option_rationales.length === options.length
      ? raw.option_rationales.map((r) => r.trim())
      : null
  if (raw.type === 'mcq') {
    if (!validIndex(raw.correct_index, options.length)) return null
    return { answer: { type: 'mcq', correctIndex: raw.correct_index }, rationales }
  }
  const indices = raw.correct_indices
  if (indices === null || indices.length === 0) return null
  if (!indices.every((i) => validIndex(i, options.length))) return null
  const unique = [...new Set(indices)].sort((a, b) => a - b)
  return { answer: { type: 'multi', correctIndices: unique }, rationales }
}

function answerOf(
  raw: RawQuestion
): { answer: QuestionAnswer; options: string[] | null; rationales: string[] | null } | null {
  switch (raw.type) {
    case 'mcq':
    case 'multi': {
      const options = validOptions(raw.options)
      if (options === null) return null
      const choice = choiceAnswer(raw, options)
      return choice === null ? null : { ...choice, options }
    }
    case 'tf':
      if (raw.tf_answer === null) return null
      return { answer: { type: 'tf', value: raw.tf_answer }, options: null, rationales: null }
    case 'short': {
      const modelAnswer = raw.model_answer?.trim() ?? ''
      if (modelAnswer === '') return null
      const rubric = cleanStrings(raw.rubric ?? [], MAX_RUBRIC_POINTS)
      return { answer: { type: 'short', modelAnswer, rubric }, options: null, rationales: null }
    }
    case 'numeric': {
      if (raw.numeric_value === null || !Number.isFinite(raw.numeric_value)) return null
      const unit = raw.numeric_unit?.trim() ?? ''
      return {
        answer: {
          type: 'numeric',
          value: raw.numeric_value,
          tolerance: normalizeTolerance(raw.numeric_tolerance),
          unit: unit === '' ? null : unit
        },
        options: null,
        rationales: null
      }
    }
  }
}

/**
 * Converts one raw question, or returns null when it is inconsistent: empty stem, a type outside
 * `allowedTypes`, an mcq/multi without 3..6 distinct options or with an out-of-range key, a tf
 * without its boolean, a short answer without a model answer, a numeric without a finite value.
 * Option rationales are kept only when there is exactly one per option.
 */
export function convertQuestion(
  raw: RawQuestion,
  allowedTypes: readonly QuestionType[] | null
): ConvertedQuestion | null {
  const stem = raw.stem.trim()
  if (stem === '') return null
  if (allowedTypes !== null && !allowedTypes.includes(raw.type)) return null
  const converted = answerOf(raw)
  if (converted === null) return null
  return {
    type: raw.type,
    stem,
    options: converted.options,
    answer: converted.answer,
    explanation: raw.explanation.trim(),
    optionRationales: converted.rationales,
    difficulty: Math.round(clamp(raw.difficulty, 1, 5, 3)),
    sourcePages: raw.source_pages,
    evidence: raw.evidence
  }
}
