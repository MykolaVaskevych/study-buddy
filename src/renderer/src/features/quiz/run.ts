import type { AttemptResult, QuizResult, QuizSession } from '@shared/domain'
import { emptyDraft } from './question/response'
import type { Draft } from './question/response'

/** 'instant' marks each answer right away; 'end' is exam mode, everything is marked at hand-in. */
export type RevealMode = 'instant' | 'end'

export type RunPhase = 'answering' | 'checking' | 'feedback' | 'handing_in' | 'done'

export interface RunState {
  /** Question ids in order. */
  ids: string[]
  index: number
  drafts: Record<string, Draft>
  results: Record<string, AttemptResult>
  /** Reported as bad before being answered: skipped and not marked. */
  skipped: string[]
  phase: RunPhase
  result: QuizResult | null
  error: string | null
}

export type RunAction =
  | { type: 'draft'; questionId: string; draft: Draft }
  | { type: 'check' }
  | { type: 'answered'; result: AttemptResult }
  | { type: 'failed'; message: string }
  | { type: 'goto'; index: number }
  | { type: 'skip'; questionId: string }
  | { type: 'handIn' }
  | { type: 'finished'; result: QuizResult }

export function initialRun(session: QuizSession): RunState {
  return {
    ids: session.questions.map((q) => q.id),
    index: 0,
    drafts: Object.fromEntries(session.questions.map((q) => [q.id, emptyDraft(q.type)])),
    results: {},
    skipped: [],
    phase: session.questions.length === 0 ? 'done' : 'answering',
    result: null,
    error: null
  }
}

const currentId = (s: RunState): string | undefined => s.ids[s.index]

/** Pure state machine of one quiz run; side effects (quiz.answer / quiz.finish) live in useQuizRun. */
export function runReducer(state: RunState, action: RunAction): RunState {
  switch (action.type) {
    case 'draft':
      if (state.phase !== 'answering' || state.results[action.questionId]) return state
      return { ...state, drafts: { ...state.drafts, [action.questionId]: action.draft }, error: null }
    case 'check':
      return state.phase === 'answering' ? { ...state, phase: 'checking', error: null } : state
    case 'answered': {
      const results = { ...state.results, [action.result.questionId]: action.result }
      const shown = state.phase === 'checking' && currentId(state) === action.result.questionId
      return { ...state, results, phase: shown ? 'feedback' : state.phase }
    }
    case 'failed':
      return { ...state, phase: 'answering', error: action.message }
    case 'goto': {
      if (state.phase === 'checking' || state.phase === 'handing_in' || state.phase === 'done') return state
      const index = Math.max(0, Math.min(state.ids.length - 1, action.index))
      const id = state.ids[index]
      return { ...state, index, phase: id && state.results[id] ? 'feedback' : 'answering', error: null }
    }
    case 'skip':
      return state.skipped.includes(action.questionId)
        ? state
        : { ...state, skipped: [...state.skipped, action.questionId] }
    case 'handIn':
      return state.phase === 'done' ? state : { ...state, phase: 'handing_in', error: null }
    case 'finished':
      return { ...state, phase: 'done', result: action.result }
  }
}

/** Next question after the current one that was not skipped, or null at the end. */
export function nextIndex(state: RunState): number | null {
  for (let i = state.index + 1; i < state.ids.length; i++) {
    const id = state.ids[i]
    if (id && !state.skipped.includes(id)) return i
  }
  return null
}

/** Questions still counted (not skipped). */
export function countedIds(state: RunState): string[] {
  return state.ids.filter((id) => !state.skipped.includes(id))
}
