import { useEffect, useReducer, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { Card, Rating } from '@shared/domain'
import { useCardStats, useReviewCard, useSetCardStatus } from '../../api/hooks'
import { isEditableTarget } from '../../app/shortcuts'
import { toast } from '../../app/toasts'
import { Button, buttonClass, cx, EmptyState, IconButton, Kbd, Progress } from '../../components'
import { CardEditDialog } from './CardEditDialog'
import { IndexCard } from './IndexCard'
import {
  formatNextDue,
  initialReview,
  LEARN_AHEAD_MS,
  recallRate,
  reviewKeyAction,
  reviewReducer
} from './session'
import type { ReviewKey } from './session'

const RATINGS: { rating: Rating; label: string; className: string }[] = [
  { rating: 1, label: 'Again', className: 'text-redpen' },
  { rating: 2, label: 'Hard', className: '' },
  { rating: 3, label: 'Good', className: '' },
  { rating: 4, label: 'Easy', className: '' }
]

const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('button, a[href], summary, select') !== null

/** Window keys for the session; the latest handler is used without re-subscribing. */
function useReviewKeys(onKey: (key: ReviewKey) => void): void {
  const latest = useRef(onKey)
  useEffect(() => {
    latest.current = onKey
  })
  useEffect(() => {
    const listener = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || isEditableTarget(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const action = reviewKeyAction(e)
      // Space on a focused button keeps its native meaning (press the button).
      if (!action || (action.type === 'flip' && isControl(e.target))) return
      e.preventDefault()
      latest.current(action)
    }
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}

function pct(value: number | null): string {
  return value === null ? '–' : `${Math.round(value * 100)}%`
}

function NextDue({
  docId,
  courseId,
  lead
}: {
  docId: string | null
  courseId?: string | null
  lead: string
}): React.JSX.Element | null {
  const stats = useCardStats(docId, courseId)
  const [now] = useState(() => new Date())
  const s = stats.data
  if (!s) return null
  if (s.total === 0) return <p>You have no flashcards yet. Open a book and make some from its Cards tab.</p>
  return (
    <p>
      {lead}{' '}
      {s.nextDue ? `The next card is due ${formatNextDue(s.nextDue, now)}.` : 'No other cards are scheduled.'}
    </p>
  )
}

/** Nothing due when the session starts. */
export function NothingDue({
  docId,
  courseId
}: {
  docId: string | null
  courseId?: string | null
}): React.JSX.Element {
  return (
    <EmptyState
      icon="review"
      title="Nothing due right now"
      actions={
        <Link to="/" className={buttonClass('secondary')}>
          Go to the library
        </Link>
      }
    >
      <NextDue docId={docId} courseId={courseId} lead="You are up to date." />
    </EmptyState>
  )
}

interface ReviewSessionProps {
  /** Due cards at the start; the session keeps its own queue from here. */
  initial: Card[]
  /**
   * Which rated cards come back this session. 'due' (Review): any card due again within
   * LEARN_AHEAD_MS. 'missedOnce' (a cram's fixed set): only a card rated Again, and only once, because
   * near an exam every card is due again within minutes and the session would never end.
   */
  repeat?: 'due' | 'missedOnce'
  docId: string | null
  courseId?: string | null
  bookTitles: Map<string, string>
  /** Cards due right now according to the latest fetch (for "Review N more"). */
  dueNow: number
  onRestart: () => void
  /** Replaces the next-due line and buttons at the end (e.g. the cram's next step). */
  finish?: React.ReactNode
}

/** One review session: flip, rate 1–4, browse with j/k, edit with e, suspend with s. */
export function ReviewSession({
  initial,
  repeat = 'due',
  docId,
  courseId,
  bookTitles,
  dueNow,
  onRestart,
  finish
}: ReviewSessionProps): React.JSX.Element {
  const [state, dispatch] = useReducer(reviewReducer, initial, initialReview)
  const [editing, setEditing] = useState<Card | null>(null)
  const review = useReviewCard()
  const setStatus = useSetCardStatus()
  const card = state.pending[state.pos] ?? null
  const cardRef = useRef<HTMLElement>(null)
  const shownAt = useRef(0)
  /** Cards already given their second look ('missedOnce'). */
  const repeated = useRef(new Set<string>())
  const [breakAt, setBreakAt] = useState(2)
  const [stopped, setStopped] = useState(false)
  const cardId = card?.id ?? null

  useEffect(() => {
    shownAt.current = performance.now()
    cardRef.current?.focus({ preventScroll: true })
  }, [cardId])

  const rate = (rating: Rating): void => {
    if (!card || !state.flipped) return
    const elapsedMs = Math.max(0, Math.round(performance.now() - shownAt.current))
    // Move on at once; the schedule is saved in the background.
    dispatch({ type: 'rated', cardId: card.id, rating })
    review.mutateAsync({ cardId: card.id, rating, elapsedMs }).then(
      (updated) => {
        if (repeat === 'due' && Date.parse(updated.srs.due) - Date.now() <= LEARN_AHEAD_MS)
          dispatch({ type: 'requeue', card: updated })
        else if (repeat === 'missedOnce' && rating === 1 && !repeated.current.has(card.id)) {
          repeated.current.add(card.id)
          dispatch({ type: 'requeue', card: updated })
        }
      },
      () => dispatch({ type: 'restore', card, rating })
    )
  }

  const suspend = (): void => {
    if (!card) return
    dispatch({ type: 'remove', cardId: card.id })
    setStatus.mutate(
      { cardId: card.id, status: 'suspended' },
      {
        onSuccess: () =>
          toast({ tone: 'ok', title: 'Card suspended', body: 'Restore it from the Cards tab of its book.' }),
        onError: () => dispatch({ type: 'restore', card, rating: null })
      }
    )
  }

  useReviewKeys((key) => {
    if (key.type === 'flip') dispatch({ type: 'flip' })
    else if (key.type === 'rate') rate(key.rating)
    else if (key.type === 'move') dispatch({ type: 'move', delta: key.delta })
    else if (key.type === 'edit' && card) setEditing(card)
    else if (key.type === 'suspend') suspend()
  })

  const done = state.log.length
  const left = state.pending.length
  const recall = recallRate(state.log)
  // How often each card was rated this session. Near an exam every card comes back within minutes,
  // so the queue never empties: rounds show progress, and a break is offered after every card has
  // had `breakAt` ratings.
  const seen = new Map<string, number>()
  for (const l of state.log) seen.set(l.cardId, (seen.get(l.cardId) ?? 0) + 1)
  const inSession = new Set([...state.pending.map((c) => c.id), ...seen.keys()])
  const round = card ? (seen.get(card.id) ?? 0) + 1 : 1
  const breakTime =
    repeat === 'due' && inSession.size > 0 && [...inSession].every((id) => (seen.get(id) ?? 0) >= breakAt)

  if (!card || stopped) {
    if (done === 0 && finish === undefined) return <NothingDue docId={docId} courseId={courseId} />
    return (
      <section aria-label="Session finished" className="flex flex-col items-start gap-5 py-6">
        <h2 className="font-serif text-2xl font-semibold">Done for now</h2>
        <div className="flex flex-col gap-1 text-md text-graphite">
          <p>
            You reviewed <span className="tabular font-semibold text-ink">{done}</span> card
            {done === 1 ? '' : 's'} and recalled{' '}
            <span className="tabular font-semibold text-ink">{pct(recall)}</span> of them.
          </p>
          {finish === undefined ? <NextDue docId={docId} courseId={courseId} lead="" /> : null}
        </div>
        {finish ?? (
          <div className="flex gap-2">
            {dueNow > 0 ? (
              <Button variant="primary" onClick={onRestart}>
                Review {dueNow} more
              </Button>
            ) : null}
            <Link to="/" className={buttonClass(dueNow > 0 ? 'ghost' : 'secondary')}>
              Back to the library
            </Link>
          </div>
        )}
      </section>
    )
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <p className="flex items-baseline gap-6 text-sm text-graphite">
          <span>
            <span className="tabular mr-1.5 font-serif text-lg font-semibold text-ink">{left}</span>left
          </span>
          <span>
            <span className="tabular mr-1.5 font-serif text-lg font-semibold text-ink">{done}</span>reviewed
          </span>
          <span>
            Recall
            <span className="tabular ml-1.5 font-serif text-lg font-semibold text-ink">{pct(recall)}</span>
          </span>
          <span className="tabular ml-auto text-faint">
            {round > 1 ? `Round ${round} · ` : ''}Card {state.pos + 1} of {left}
          </span>
        </p>
        <Progress
          value={done + left > 0 ? done / (done + left) : 0}
          label="Session progress"
          valueText={`${done} reviewed, ${left} left`}
          size="xs"
        />
      </div>

      {breakTime ? (
        <section
          aria-label="Take a break"
          className="flex flex-wrap items-center gap-3 rounded-lg border border-accent bg-accent-soft p-4"
        >
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-semibold">
              Every card done {breakAt} times, recall {pct(recall)}.
            </span>{' '}
            With the exam this close they come back within minutes. Take a break and come back later.
          </p>
          <Button size="sm" variant="primary" onClick={() => setStopped(true)}>
            Finish for now
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setBreakAt((b) => b + 2)}>
            Keep going
          </Button>
        </section>
      ) : null}

      <div data-tour="review-card">
        <IndexCard
          ref={cardRef}
          card={card}
          flipped={state.flipped}
          bookTitle={docId === null ? (bookTitles.get(card.docId) ?? null) : null}
        />
      </div>

      <div data-tour="review-ratings" className="flex min-h-11 items-stretch gap-2">
        {state.flipped ? (
          RATINGS.map(({ rating, label, className }) => (
            <button
              key={rating}
              type="button"
              onClick={() => rate(rating)}
              aria-keyshortcuts={String(rating)}
              className={cx(buttonClass(rating === 3 ? 'primary' : 'secondary'), 'h-11 flex-1', className)}
            >
              {label}
              <Kbd keys={String(rating)} tone={rating === 3 ? 'inverse' : 'default'} />
            </button>
          ))
        ) : (
          <button
            type="button"
            onClick={() => dispatch({ type: 'flip' })}
            aria-keyshortcuts="Space"
            className={cx(buttonClass('primary'), 'h-11 flex-1')}
          >
            Show answer
            <Kbd keys="Space" tone="inverse" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-graphite">
        <span className="flex items-center gap-1.5">
          <Kbd keys="k" />
          <Kbd keys="j" /> previous / next card
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys="e" /> edit
        </span>
        <span className="flex items-center gap-1.5">
          <Kbd keys="s" /> suspend
        </span>
        <span className="ml-auto flex items-center gap-1">
          <IconButton
            icon="pencil"
            label="Edit card"
            shortcut="e"
            size="sm"
            onClick={() => setEditing(card)}
          />
          <IconButton icon="pause" label="Suspend card" shortcut="s" size="sm" onClick={suspend} />
        </span>
      </div>

      <CardEditDialog
        card={editing}
        onClose={() => setEditing(null)}
        onSaved={(saved) => dispatch({ type: 'replace', card: saved })}
      />
    </div>
  )
}
