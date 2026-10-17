import type { Card, Rating } from '@shared/domain'
import type { KeyLike } from '../../app/shortcuts'

/**
 * A review session works on a snapshot of the due queue: refetches after each rating must not
 * reshuffle the card on screen. Rated cards leave the queue; cards that come back within the
 * learn-ahead window (an "Again") are appended so they are seen again this session.
 */

export const LEARN_AHEAD_MS = 20 * 60_000

export interface ReviewState {
  pending: Card[]
  pos: number
  flipped: boolean
  log: { cardId: string; rating: Rating }[]
}

export type ReviewAction =
  | { type: 'flip' }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'rated'; cardId: string; rating: Rating }
  /** The server's updated card is due again soon: show it again at the end of the queue. */
  | { type: 'requeue'; card: Card }
  /** Rating or suspending failed: put the card back in front (and drop the rating from the log). */
  | { type: 'restore'; card: Card; rating: Rating | null }
  | { type: 'remove'; cardId: string }
  | { type: 'replace'; card: Card }

export function initialReview(cards: Card[]): ReviewState {
  return { pending: cards, pos: 0, flipped: false, log: [] }
}

const clampPos = (pos: number, length: number): number =>
  length === 0 ? 0 : pos >= length ? 0 : Math.max(0, pos)

function without(state: ReviewState, cardId: string): ReviewState {
  const index = state.pending.findIndex((c) => c.id === cardId)
  if (index < 0) return state
  const pending = state.pending.filter((c) => c.id !== cardId)
  const pos = index < state.pos ? state.pos - 1 : state.pos
  return { ...state, pending, pos: clampPos(pos, pending.length), flipped: false }
}

export function reviewReducer(state: ReviewState, action: ReviewAction): ReviewState {
  switch (action.type) {
    case 'flip':
      return state.pending.length ? { ...state, flipped: !state.flipped } : state
    case 'move': {
      const n = state.pending.length
      if (n < 2) return state
      return { ...state, pos: (state.pos + action.delta + n) % n, flipped: false }
    }
    case 'rated':
      return {
        ...without(state, action.cardId),
        log: [...state.log, { cardId: action.cardId, rating: action.rating }]
      }
    case 'requeue':
      return state.pending.some((c) => c.id === action.card.id)
        ? state
        : { ...state, pending: [...state.pending, action.card] }
    case 'restore': {
      const i =
        action.rating === null
          ? -1
          : state.log.findLastIndex((l) => l.cardId === action.card.id && l.rating === action.rating)
      const log = i < 0 ? state.log : state.log.filter((_, j) => j !== i)
      const rest = state.pending.filter((c) => c.id !== action.card.id)
      return { ...state, pending: [action.card, ...rest], pos: 0, flipped: false, log }
    }
    case 'remove':
      return without(state, action.cardId)
    case 'replace':
      return { ...state, pending: state.pending.map((c) => (c.id === action.card.id ? action.card : c)) }
  }
}

/** Share of reviews recalled (Hard, Good or Easy); null before the first rating. */
export function recallRate(log: ReviewState['log']): number | null {
  if (log.length === 0) return null
  return log.filter((l) => l.rating > 1).length / log.length
}

export type ReviewKey =
  | { type: 'flip' }
  | { type: 'rate'; rating: Rating }
  | { type: 'move'; delta: 1 | -1 }
  | { type: 'edit' }
  | { type: 'suspend' }

/** Review keymap: Space flips, 1–4 rate, j/k move, e edits, s suspends. */
export function reviewKeyAction(e: KeyLike): ReviewKey | null {
  if (e.ctrlKey || e.metaKey || e.altKey) return null
  switch (e.key) {
    case ' ':
      return { type: 'flip' }
    case '1':
    case '2':
    case '3':
    case '4':
      return { type: 'rate', rating: Number(e.key) as Rating }
    case 'j':
      return { type: 'move', delta: 1 }
    case 'k':
      return { type: 'move', delta: -1 }
    case 'e':
      return { type: 'edit' }
    case 's':
      return { type: 'suspend' }
  }
  return null
}

/** "in 3 hours", "tomorrow at 09:00", "on 21 Oct": when the next card is due. */
export function formatNextDue(iso: string, now: Date): string {
  const due = new Date(iso)
  const ms = due.getTime() - now.getTime()
  if (ms <= 60_000) return 'now'
  const minutes = Math.round(ms / 60_000)
  if (minutes < 60) return `in ${minutes} minute${minutes === 1 ? '' : 's'}`
  const time = due.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const startOfDay = (d: Date): number => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(due) - startOfDay(now)) / 86_400_000)
  if (days === 0) {
    const hours = Math.round(minutes / 60)
    return `in ${hours} hour${hours === 1 ? '' : 's'}, at ${time}`
  }
  if (days === 1) return `tomorrow at ${time}`
  if (days < 7) return `in ${days} days`
  return `on ${due.toLocaleDateString([], { day: 'numeric', month: 'short' })}`
}
