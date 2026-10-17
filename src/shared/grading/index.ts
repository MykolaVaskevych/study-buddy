import type { AttemptResult, Question, QuestionAnswer } from '../domain'
import type { FormatAnswer, GradeObjective } from './types'
import { hasDim, normaliseUnitText, parseUnit, type ParsedUnit } from './units'

export type { FormatAnswer, GradeObjective } from './types'
export { parseUnit } from './units'

type NumericAnswer = Extract<QuestionAnswer, { type: 'numeric' }>

/** Floor for the relative tolerance: absorbs float noise from unit conversion (2.5e9 / 1e6). */
const FLOAT_EPSILON = 1e-9

const letter = (i: number): string => String.fromCharCode(65 + i)

/** Up to 10 significant digits, without float artefacts like 0.30000000000000004. */
function formatNumber(n: number): string {
  return String(Number(n.toPrecision(10)))
}

function optionLine(question: Question, index: number): string {
  const text = question.options?.[index]
  return text === undefined ? `**${letter(index)}**` : `**${letter(index)}** — ${text}`
}

/** Markdown for the correct answer, e.g. "**B** — 1550 nm", "True", "10 dB (±2 %)". */
export const formatAnswer: FormatAnswer = (question) => {
  const answer = question.answer
  switch (answer.type) {
    case 'mcq':
      return optionLine(question, answer.correctIndex)
    case 'multi':
      return [...new Set(answer.correctIndices)]
        .sort((a, b) => a - b)
        .map((i) => `- ${optionLine(question, i)}`)
        .join('\n')
    case 'tf':
      return answer.value ? 'True' : 'False'
    case 'short':
      return answer.modelAnswer
    case 'numeric': {
      const unit = answer.unit?.trim() ? ` ${answer.unit.trim()}` : ''
      const tolerance = answer.tolerance > 0 ? ` (±${formatNumber(answer.tolerance * 100)} %)` : ''
      return `${formatNumber(answer.value)}${unit}${tolerance}`
    }
  }
}

/** Relative tolerance; absolute fallback when the expected value is 0 (relative would demand exactness). */
function withinTolerance(given: number, expected: number, tolerance: number): boolean {
  const tol = Number.isFinite(tolerance) && tolerance > 0 ? tolerance : 0
  const diff = Math.abs(given - expected)
  if (expected === 0) return diff <= Math.max(tol, FLOAT_EPSILON)
  return diff <= Math.abs(expected) * Math.max(tol, FLOAT_EPSILON)
}

/** "Off by 1000x" usually means a wrong prefix (m vs M, k vs M); worth saying so. */
function prefixHint(given: number, expected: number, tolerance: number): string | null {
  if (given === 0 || expected === 0 || Math.sign(given) !== Math.sign(expected)) return null
  const exponent = Math.log10(given / expected)
  const k = Math.round(exponent)
  const slack = Math.log10(1 + Math.max(tolerance, FLOAT_EPSILON))
  return k !== 0 && k % 3 === 0 && Math.abs(exponent - k) <= slack
    ? ` Your value is off by a factor of 10^${k}: check the unit prefix.`
    : null
}

/** Why two parsed units with different dimensions are not interchangeable. */
function dimensionMismatch(
  expected: ParsedUnit,
  given: ParsedUnit,
  expUnit: string,
  givenUnit: string
): string {
  const isDb = (u: ParsedUnit) => hasDim(u, 'dB')
  const isDbm = (u: ParsedUnit) => hasDim(u, 'dBm')
  const isWatt = (u: ParsedUnit) => hasDim(u, 'W')
  if (isDb(expected) && isDbm(given)) {
    return `dBm is an absolute power level (relative to 1 mW), but dB is a ratio between two powers. The question asks for a ratio in ${expUnit}.`
  }
  if (isDbm(expected) && isDb(given)) {
    return `dB is a ratio, but the question asks for an absolute power level in ${expUnit} (relative to 1 mW).`
  }
  if (isDbm(expected) && isWatt(given)) {
    return `The question asks for a logarithmic power level in ${expUnit}; ${givenUnit} is a linear power unit. Convert with P(dBm) = 10·log10(P / 1 mW).`
  }
  if (isWatt(expected) && isDbm(given)) {
    return `The question asks for a linear power in ${expUnit}; ${givenUnit} is a logarithmic level. Convert with P = 1 mW · 10^(dBm/10).`
  }
  if ((hasDim(expected, 'bit') && hasDim(given, 'B')) || (hasDim(expected, 'B') && hasDim(given, 'bit'))) {
    return `The question uses ${expUnit}, you answered in ${givenUnit}: bits (b) and bytes (B) differ by a factor of 8.`
  }
  return `The question asks for a value in ${expUnit}; ${givenUnit} measures a different quantity.`
}

interface Verdict {
  correct: boolean
  feedback: string | null
}

function gradeNumeric(answer: NumericAnswer, value: number, unit: string | null): Verdict {
  if (!Number.isFinite(value)) return { correct: false, feedback: 'The answer is not a number.' }
  const expUnit = answer.unit?.trim() ? normaliseUnitText(answer.unit) : null
  const givenUnit = unit?.trim() ? normaliseUnitText(unit) : null
  const tol = answer.tolerance
  const plain = (given: number, note: string | null): Verdict =>
    withinTolerance(given, answer.value, tol)
      ? { correct: true, feedback: note }
      : { correct: false, feedback: prefixHint(given, answer.value, tol)?.trim() ?? null }

  if (expUnit === null)
    return plain(value, givenUnit ? 'No unit was expected; only the number is graded.' : null)
  if (givenUnit === null) {
    const verdict = plain(value, null)
    return {
      correct: verdict.correct,
      feedback: verdict.correct
        ? `Correct value, but include the unit (${expUnit}).`
        : `Include the unit (${expUnit}) with your answer.`
    }
  }

  const expected = parseUnit(expUnit)
  const given = parseUnit(givenUnit)
  if (!expected || !given) {
    // Unknown unit: no conversion possible, so the unit must be written exactly as in the question.
    if (expUnit !== givenUnit) {
      return { correct: false, feedback: `The question asks for the answer in ${expUnit}, not ${givenUnit}.` }
    }
    return plain(value, null)
  }
  if (expected.key !== given.key) {
    return { correct: false, feedback: dimensionMismatch(expected, given, expUnit, givenUnit) }
  }
  const converted = (value * given.factor) / expected.factor
  const note =
    expUnit === givenUnit
      ? null
      : `${formatNumber(value)} ${givenUnit} = ${formatNumber(converted)} ${expUnit}.`
  if (withinTolerance(converted, answer.value, tol)) return { correct: true, feedback: note }
  const hint = prefixHint(converted, answer.value, tol)
  return { correct: false, feedback: [note, hint?.trim()].filter(Boolean).join(' ') || null }
}

/**
 * Grades mcq / multi / tf / numeric deterministically; returns null for 'short' (graded by the AI).
 * The answer key's own `type` is authoritative; a response of another type scores 0.
 */
export const gradeObjective: GradeObjective = (question, response) => {
  const answer = question.answer
  if (answer.type === 'short') return null
  const result = (
    correct: boolean,
    score: number,
    feedback: string | null,
    missingPoints: string[] = []
  ): AttemptResult => ({
    questionId: question.id,
    correct,
    score,
    feedback,
    missingPoints,
    correctAnswer: formatAnswer(question)
  })
  const mismatch = () => result(false, 0, `Expected a ${answer.type} answer, got ${response.type}.`)

  switch (answer.type) {
    case 'mcq': {
      if (response.type !== 'mcq') return mismatch()
      const correct = response.index === answer.correctIndex
      return result(correct, correct ? 1 : 0, question.optionRationales?.[response.index] ?? null)
    }
    case 'tf': {
      if (response.type !== 'tf') return mismatch()
      const correct = response.value === answer.value
      return result(correct, correct ? 1 : 0, null)
    }
    case 'multi': {
      if (response.type !== 'multi') return mismatch()
      const key = new Set(answer.correctIndices)
      const picks = new Set(response.indices)
      const right = [...picks].filter((i) => key.has(i)).length
      const wrong = picks.size - right
      const correct = right === key.size && wrong === 0
      // "None of the options" keys: full credit only for an empty selection.
      const score = key.size === 0 ? (picks.size === 0 ? 1 : 0) : Math.max(0, (right - wrong) / key.size)
      const missed = [...key]
        .filter((i) => !picks.has(i))
        .sort((a, b) => a - b)
        .map((i) => question.options?.[i] ?? letter(i))
      const feedback = correct
        ? null
        : `You picked ${right} of ${key.size} correct option${key.size === 1 ? '' : 's'}` +
          (wrong > 0 ? ` and ${wrong} wrong one${wrong === 1 ? '' : 's'}.` : '.')
      return result(correct, score, feedback, missed)
    }
    case 'numeric': {
      if (response.type !== 'numeric') return mismatch()
      const verdict = gradeNumeric(answer, response.value, response.unit)
      return result(verdict.correct, verdict.correct ? 1 : 0, verdict.feedback)
    }
  }
}
