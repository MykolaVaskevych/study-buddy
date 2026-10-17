import type { Question, QuestionResponse, QuestionType } from '@shared/domain'

/**
 * What the person has entered so far for one question. Kept as raw input (strings for numbers)
 * so typing "1," or "−" is never rejected mid-word; `toResponse` converts it for quiz.answer.
 */
export type Draft =
  | { type: 'mcq'; index: number | null }
  | { type: 'multi'; indices: number[] }
  | { type: 'tf'; value: boolean | null }
  | { type: 'short'; text: string }
  | { type: 'numeric'; value: string; unit: string }

/** Options answerable with number keys (1–6). */
export const MAX_CHOICE_KEYS = 6

export function emptyDraft(type: QuestionType): Draft {
  switch (type) {
    case 'mcq':
      return { type, index: null }
    case 'multi':
      return { type, indices: [] }
    case 'tf':
      return { type, value: null }
    case 'short':
      return { type, text: '' }
    case 'numeric':
      return { type, value: '', unit: '' }
  }
}

/** The labels of the choices a question offers; empty for typed answers. */
export function choiceLabels(question: Question): string[] {
  if (question.type === 'tf') return ['True', 'False']
  if (question.type === 'mcq' || question.type === 'multi') return question.options ?? []
  return []
}

/** Picks option `index`: selects it (mcq, tf) or toggles it (multi). Other drafts are unchanged. */
export function pickChoice(draft: Draft, index: number): Draft {
  switch (draft.type) {
    case 'mcq':
      return { ...draft, index }
    case 'tf':
      return index === 0 || index === 1 ? { ...draft, value: index === 0 } : draft
    case 'multi':
      return {
        ...draft,
        indices: draft.indices.includes(index)
          ? draft.indices.filter((i) => i !== index)
          : [...draft.indices, index].sort((a, b) => a - b)
      }
    default:
      return draft
  }
}

export function isChosen(draft: Draft, index: number): boolean {
  switch (draft.type) {
    case 'mcq':
      return draft.index === index
    case 'tf':
      return draft.value !== null && (draft.value ? 0 : 1) === index
    case 'multi':
      return draft.indices.includes(index)
    default:
      return false
  }
}

const NUMBER = /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i

/**
 * Parses a typed number: "−16", "1,5", "2.5e9", "2.5×10^9", "1 000". Returns null if it is not
 * a plain number (units belong in their own field).
 */
export function parseDecimal(raw: string): number | null {
  let s = raw
    .trim()
    .replace(/[−–]/g, '-')
    // \s covers no-break and narrow no-break spaces too.
    .replace(/\s/g, '')
  s = s.replace(/[×x*·]10\^([-+]?\d+)$/i, 'e$1')
  if (s.includes(',')) s = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.')
  if (!NUMBER.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/** "−16 dBm" → value "−16", unit "dBm", for people who type the unit into the value field. */
export function splitValueUnit(raw: string): { value: string; unit: string } {
  const m = /^\s*([-+−]?[\d.,\s]*\d(?:\s*(?:e[-+−]?\d+|[×x*]\s*10\^?\s*[-+−]?\d+))?)\s*(.*?)\s*$/i.exec(raw)
  return m?.[1] !== undefined ? { value: m[1], unit: m[2] ?? '' } : { value: raw, unit: '' }
}

/** The response to send to quiz.answer, or null while the draft is incomplete. */
export function toResponse(draft: Draft): QuestionResponse | null {
  switch (draft.type) {
    case 'mcq':
      return draft.index === null ? null : { type: 'mcq', index: draft.index }
    case 'tf':
      return draft.value === null ? null : { type: 'tf', value: draft.value }
    case 'multi':
      return draft.indices.length === 0 ? null : { type: 'multi', indices: draft.indices }
    case 'short': {
      const text = draft.text.trim()
      return text ? { type: 'short', text: text.slice(0, 5000) } : null
    }
    case 'numeric': {
      const parts = draft.unit.trim() ? draft : splitValueUnit(draft.value)
      const value = parseDecimal(parts.value)
      if (value === null) return null
      const unit = parts.unit.trim()
      return { type: 'numeric', value, unit: unit || null }
    }
  }
}

export type OptionMark = 'right' | 'wrong' | 'missed' | null

/** How an option is marked after grading: picked and right, picked and wrong, or a missed answer. */
export function optionMark(question: Question, draft: Draft, index: number): OptionMark {
  const key = question.answer
  const correct =
    key.type === 'mcq'
      ? key.correctIndex === index
      : key.type === 'multi'
        ? key.correctIndices.includes(index)
        : key.type === 'tf'
          ? (key.value ? 0 : 1) === index
          : false
  const chosen = isChosen(draft, index)
  if (chosen) return correct ? 'right' : 'wrong'
  return correct ? 'missed' : null
}

/** Human summary of what was answered, for result lists ("B", "True", "−16 dBm"). */
export function describeResponse(question: Question, response: QuestionResponse | null): string {
  if (!response) return 'No answer'
  const letter = (i: number): string => String.fromCharCode(65 + i)
  switch (response.type) {
    case 'mcq':
      return `${letter(response.index)}: ${question.options?.[response.index] ?? ''}`.trim()
    case 'multi':
      return response.indices.map(letter).join(', ') || 'None'
    case 'tf':
      return response.value ? 'True' : 'False'
    case 'short':
      return response.text
    case 'numeric':
      return response.unit ? `${response.value} ${response.unit}` : String(response.value)
  }
}
