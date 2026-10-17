import type { AttemptResult, Question, QuestionResponse } from '../domain'

/**
 * Deterministic grading contract (owner: data work package), implemented in src/shared/grading.
 * gradeObjective handles mcq / multi / tf / numeric locally and returns null for 'short' answers,
 * which are graded by the AI.
 * Numeric: relative tolerance, unit normalisation (k/M/G/T, m/µ/n/p prefixes, Hz, bit/s, W),
 * dB vs dBm awareness (a dBm answer to a dB question is not silently accepted).
 * Multi: partial credit = max(0, (right picks - wrong picks) / correct count).
 */
export type GradeObjective = (question: Question, response: QuestionResponse) => AttemptResult | null

/** Markdown rendering of the correct answer for result screens. */
export type FormatAnswer = (question: Question) => string
