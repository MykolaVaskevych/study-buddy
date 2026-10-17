import type { QuestionAnswer, QuestionType } from '@shared/domain'
import type { VerifyOutput } from '@shared/ai/schemas'
import type { QuestionDraft } from '../types'

/**
 * Answer-key verification. A second, blind model pass answers the objective questions without
 * seeing the key; the comparison happens here, in code, so a model cannot "agree" by restating
 * the key. Only types with a machine-checkable answer are verified.
 */

export type BlindAnswer = VerifyOutput['answers'][number]
export type Agreement = 'agree' | 'disagree' | 'unanswerable' | 'missing'

export const VERIFIABLE_TYPES: ReadonlySet<QuestionType> = new Set(['mcq', 'multi', 'tf', 'numeric'])

/** Absorbs rounding differences (e.g. 3.14 vs 3.1416) on numeric keys with a tight tolerance. */
const MIN_RELATIVE_TOLERANCE = 0.005

/** Stable ids for the blind pass: position-based, so no question content leaks into the id. */
export function verifyId(index: number): string {
  return `q${index + 1}`
}

/** True when `value` lies within the key's relative tolerance (floored for rounding). */
export function numericAgrees(key: number, value: number, tolerance: number): boolean {
  if (!Number.isFinite(value)) return false
  const allowed = Math.max(tolerance, MIN_RELATIVE_TOLERANCE) * Math.abs(key)
  return Math.abs(value - key) <= Math.max(allowed, 1e-9)
}

/**
 * Compares the key with the blind answer. 'missing' means the verifier gave no usable answer
 * (no entry, or the field for this type is null) and says nothing about the key.
 */
export function compareAnswer(answer: QuestionAnswer, blind: BlindAnswer | undefined): Agreement {
  if (blind === undefined) return 'missing'
  if (!blind.answerable) return 'unanswerable'
  switch (answer.type) {
    case 'mcq':
      if (blind.choice_index === null) return 'missing'
      return blind.choice_index === answer.correctIndex ? 'agree' : 'disagree'
    case 'multi': {
      if (blind.choice_indices === null) return 'missing'
      const got = [...new Set(blind.choice_indices)].sort((a, b) => a - b)
      const want = [...answer.correctIndices].sort((a, b) => a - b)
      const same = got.length === want.length && got.every((v, i) => v === want[i])
      return same ? 'agree' : 'disagree'
    }
    case 'tf':
      if (blind.tf_answer === null) return 'missing'
      return blind.tf_answer === answer.value ? 'agree' : 'disagree'
    case 'numeric':
      if (blind.numeric_value === null) return 'missing'
      return numericAgrees(answer.value, blind.numeric_value, answer.tolerance) ? 'agree' : 'disagree'
    case 'short':
      return 'missing'
  }
}

/**
 * Applies the blind answers to the drafts (ids from `verifyId`):
 *  - disagreement or "not answerable from the pages" drops the question;
 *  - agreement keeps it with its grounding verification;
 *  - a missing blind answer keeps it but downgrades 'verified' to 'unverified', because the key
 *    was not confirmed;
 *  - non-verifiable types (short answers) pass through unchanged.
 */
export function applyBlindAnswers(drafts: readonly QuestionDraft[], output: VerifyOutput): QuestionDraft[] {
  const byId = new Map(output.answers.map((a) => [a.id.trim(), a]))
  const kept: QuestionDraft[] = []
  drafts.forEach((draft, index) => {
    if (!VERIFIABLE_TYPES.has(draft.type)) {
      kept.push(draft)
      return
    }
    const verdict = compareAnswer(draft.answer, byId.get(verifyId(index)))
    if (verdict === 'agree') kept.push(draft)
    else if (verdict === 'missing')
      kept.push({
        ...draft,
        verification: draft.verification === 'verified' ? 'unverified' : draft.verification
      })
  })
  return kept
}
