import { useEffect, useReducer, useRef } from 'react'
import type { AttemptResult, Question, QuizSession } from '@shared/domain'
import { useAnswerQuestion, useFinishQuiz } from '../../api/hooks'
import { pickChoice, toResponse } from './question/response'
import type { Draft } from './question/response'
import { countedIds, initialRun, nextIndex, runReducer } from './run'
import type { RevealMode, RunState } from './run'

export interface QuizRun {
  state: RunState
  question: Question | null
  draft: Draft | null
  /** Result of the current question, only when it may be shown (instant mode, or after hand-in). */
  shownResult: AttemptResult | null
  /** The current answer can be checked (instant) or the draft is complete (exam). */
  ready: boolean
  isLast: boolean
  setDraft: (draft: Draft) => void
  pick: (index: number) => void
  /** Instant mode: mark the current answer. */
  check: () => void
  /** After feedback (instant) or after answering (exam): next question, or finish at the end. */
  advance: () => void
  goto: (index: number) => void
  /** Exam: mark everything and finish. Instant: finish now (unanswered questions score 0). */
  handIn: () => void
  /** A question was reported: skip it if unanswered. */
  reported: (questionId: string) => void
}

const message = (e: unknown): string => (e instanceof Error ? e.message : String(e))

/**
 * Runs a quiz session: drafts, marking through quiz.answer, and quiz.finish at the end.
 * Instant mode marks each answer as it is given; exam mode ('end') keeps answers local and
 * marks them all when the quiz is handed in, so nothing is revealed early.
 */
export function useQuizRun(session: QuizSession, reveal: RevealMode): QuizRun {
  const [state, dispatch] = useReducer(runReducer, session, initialRun)
  const answer = useAnswerQuestion()
  const finish = useFinishQuiz()

  // Time on each question, for elapsedMs (FSRS-style difficulty signals in main).
  const spent = useRef<Record<string, number>>({})
  const shownAt = useRef(0)
  const id = state.ids[state.index]
  useEffect(() => {
    if (!id) return
    const start = performance.now()
    shownAt.current = start
    const times = spent.current
    return () => {
      times[id] = (times[id] ?? 0) + performance.now() - start
    }
  }, [id])
  const elapsed = (qid: string): number =>
    Math.max(
      0,
      Math.round((spent.current[qid] ?? 0) + (qid === id ? performance.now() - shownAt.current : 0))
    )

  const question = session.questions[state.index] ?? null
  const draft = question ? (state.drafts[question.id] ?? null) : null
  const result = question ? (state.results[question.id] ?? null) : null
  const showResults = reveal === 'instant' || state.phase === 'done'
  const ready = draft !== null && toResponse(draft) !== null
  const next = nextIndex(state)

  const finishNow = async (alsoSkip: string[] = []): Promise<void> => {
    dispatch({ type: 'handIn' })
    try {
      if (reveal === 'end') {
        const counted = new Set(countedIds(state).filter((q) => !alsoSkip.includes(q)))
        const pending = session.questions.filter((q) => counted.has(q.id) && !state.results[q.id])
        await Promise.all(
          pending.map(async (q) => {
            const d = state.drafts[q.id]
            const response = d ? toResponse(d) : null
            if (!response) return
            const r = await answer.mutateAsync({
              quizId: session.id,
              questionId: q.id,
              response,
              elapsedMs: elapsed(q.id)
            })
            dispatch({ type: 'answered', result: r })
          })
        )
      }
      dispatch({ type: 'finished', result: await finish.mutateAsync({ quizId: session.id }) })
    } catch (e) {
      dispatch({ type: 'failed', message: message(e) })
    }
  }

  const check = (): void => {
    if (reveal !== 'instant' || !question || !draft || state.phase !== 'answering') return
    const response = toResponse(draft)
    if (!response) return
    dispatch({ type: 'check' })
    answer
      .mutateAsync({ quizId: session.id, questionId: question.id, response, elapsedMs: elapsed(question.id) })
      .then(
        (r) => dispatch({ type: 'answered', result: r }),
        (e: unknown) => dispatch({ type: 'failed', message: message(e) })
      )
  }

  const advance = (): void => {
    if (state.phase === 'checking' || state.phase === 'handing_in' || state.phase === 'done') return
    if (reveal === 'instant' && state.phase !== 'feedback') return
    if (next === null) {
      if (reveal === 'instant') void finishNow()
      return
    }
    dispatch({ type: 'goto', index: next })
  }

  return {
    state,
    question,
    draft,
    shownResult: showResults ? result : null,
    ready,
    isLast: next === null,
    setDraft: (d) => question && dispatch({ type: 'draft', questionId: question.id, draft: d }),
    pick: (i) =>
      question && draft && dispatch({ type: 'draft', questionId: question.id, draft: pickChoice(draft, i) }),
    check,
    advance,
    goto: (index) => dispatch({ type: 'goto', index }),
    handIn: () => {
      if (state.phase !== 'handing_in' && state.phase !== 'done' && state.phase !== 'checking')
        void finishNow()
    },
    reported: (questionId) => {
      if (state.results[questionId]) return
      dispatch({ type: 'skip', questionId })
      if (questionId !== question?.id) return
      if (next !== null) dispatch({ type: 'goto', index: next })
      else void finishNow([questionId])
    }
  }
}
