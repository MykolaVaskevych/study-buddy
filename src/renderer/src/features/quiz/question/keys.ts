import type { KeyLike } from '../../../app/shortcuts'

export type QuestionKey =
  { type: 'choice'; index: number } | { type: 'enter' } | { type: 'report' } | { type: 'swallow' }

export interface QuestionKeyContext {
  /** Options that number keys can pick right now (0 once the answer is marked). */
  choices: number
  /** While a question is on screen digits never fall through (the reader maps them to tabs). */
  holdDigits: boolean
  /** Focus is on a button or link: Enter/Space keep their native meaning. */
  onControl: boolean
  canReport: boolean
}

/**
 * Keymap for answering: 1–6 pick an option, Enter checks / continues, r reports the question.
 * Pure so it can be tested without a DOM. Typing in fields is filtered out by the caller.
 */
export function questionKeyAction(e: KeyLike, ctx: QuestionKeyContext): QuestionKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  if (/^[1-9]$/.test(e.key)) {
    const index = Number(e.key) - 1
    if (index < ctx.choices) return { type: 'choice', index }
    return ctx.holdDigits ? { type: 'swallow' } : null
  }
  if (e.key === 'Enter') return ctx.onControl || e.shiftKey ? null : { type: 'enter' }
  if (e.key === 'r' && ctx.canReport) return { type: 'report' }
  return null
}
