import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { CRAM_SIZES, cramMinutes } from '@shared/cram'
import type { CramPlan, QuizSession } from '@shared/domain'
import { useCourses, useCramPlan, useCramQuiz, useDocument, useLibrary } from '../../api/hooks'
import { Button, buttonClass, cx, Icon } from '../../components'
import { formatClock } from '../quiz/ExamTimer'
import { QuizRunner } from '../quiz/QuizRunner'
import { ReviewSession } from '../review/ReviewSession'
import { panicClass } from './panic'
import { ScopePicker, scopesOf, type ScopeChoice } from './ScopePicker'

type Stage =
  | { step: 'intro' }
  | { step: 'cards'; plan: CramPlan; endsAt: number }
  | { step: 'questions'; plan: CramPlan; endsAt: number; session: QuizSession }
  | { step: 'done' }

/** Time left in the session; a nudge, never a hand-in. */
function SessionClock({ endsAt }: { endsAt: number }): React.JSX.Element {
  const [left, setLeft] = useState(() => Math.round((endsAt - Date.now()) / 1000))
  useEffect(() => {
    const tick = window.setInterval(() => setLeft(Math.round((endsAt - Date.now()) / 1000)), 1000)
    return () => window.clearInterval(tick)
  }, [endsAt])
  return (
    <span
      className={cx(
        'flex items-center gap-1.5 text-sm tabular',
        left <= 300 ? 'text-redpen' : 'text-graphite'
      )}
    >
      <Icon name="clock" size={14} />
      {left > 0 ? `${formatClock(left)} left` : 'Time is up: finish this one, then stop'}
    </span>
  )
}

/**
 * "Don't panic": for the night before the exam. The cards that matter most, then a few exam-style
 * questions with instant feedback, then sleep. Route: /book/:docId/panic
 */
export function CramScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const navigate = useNavigate()
  const doc = useDocument(docId)
  const cram = useCramPlan()
  const createQuiz = useCramQuiz()
  const courses = useCourses()
  const library = useLibrary()
  const [size, setSize] = useState<number>(20)
  const [stage, setStage] = useState<Stage>({ step: 'intro' })
  const [choice, setChoice] = useState<ScopeChoice>(() => new Map([[docId, 'all']]))
  const title = doc.data?.title ?? 'this book'
  const titles = useMemo(() => new Map((library.data ?? []).map((d) => [d.id, d.title])), [library.data])
  // The other files of this book's course (weeks, lectures) can join the cram.
  const course = courses.data?.find((c) => c.docIds.includes(docId))
  const files = (course?.docIds ?? [docId]).map((id) => ({ docId: id, title: titles.get(id) ?? title }))
  const scopes = scopesOf(
    choice,
    files.map((f) => f.docId)
  )

  const start = (): void =>
    cram.mutate(
      { docId, cards: size, scopes },
      { onSuccess: (plan) => setStage({ step: 'cards', plan, endsAt: Date.now() + plan.minutes * 60_000 }) }
    )

  const toQuestions = (plan: CramPlan, endsAt: number): void =>
    createQuiz.mutate(
      { scopes: plan.scopes, count: plan.questionCount, types: plan.questionTypes },
      { onSuccess: (session) => setStage({ step: 'questions', plan, endsAt, session }) }
    )

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-8 py-9">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-col gap-2">
            <Link
              to={`/book/${encodeURIComponent(docId)}`}
              className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-graphite hover:text-ink"
            >
              <Icon name="arrow-left" size={16} />
              {doc.data?.title ?? 'Back to the book'}
            </Link>
            <h1 className="font-serif text-2xl font-semibold">Don’t panic.</h1>
          </div>
          {stage.step === 'cards' || stage.step === 'questions' ? (
            <div className="flex items-center gap-4">
              <span className="text-sm text-graphite">
                Step {stage.step === 'cards' ? 1 : 2} of 2:{' '}
                {stage.step === 'cards' ? 'flashcards' : 'exam questions'}
              </span>
              <SessionClock endsAt={stage.endsAt} />
            </div>
          ) : null}
        </header>

        {stage.step === 'intro' ? (
          <section aria-label="Cram setup" className="flex flex-col gap-6">
            <div className="flex max-w-prose flex-col gap-2 text-md">
              <p>
                Exam soon and far too many cards? Do just this: the flashcards that matter most, spread over
                every topic, then a few exam-style questions with the answers explained. Then sleep.
              </p>
              <p className="text-sm text-graphite">
                Every topic gets its most important card first, then the heaviest topics get more. Your
                mistakes and shaky cards come first, and formula cards stay out if your exam has no formulas.
              </p>
            </div>
            <ScopePicker files={files} choice={choice} onChange={setChoice} />
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-2 text-sm font-semibold">How long have you got?</legend>
              <div className="flex flex-wrap gap-2">
                {CRAM_SIZES.map((s) => (
                  <label
                    key={s.cards}
                    className={cx(
                      'flex cursor-pointer flex-col rounded-md border px-4 py-2 text-sm has-focus-visible:outline-2 has-focus-visible:outline-focus',
                      size === s.cards
                        ? 'border-redpen bg-redpen-soft'
                        : 'border-rule bg-sheet hover:bg-sunken'
                    )}
                  >
                    <input
                      type="radio"
                      name="cram-size"
                      className="sr-only"
                      checked={size === s.cards}
                      onChange={() => setSize(s.cards)}
                    />
                    <span className="font-semibold">
                      {s.label} · about {cramMinutes(s.cards)} min
                    </span>
                    <span className="text-graphite">{s.cards} cards, then questions</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="flex flex-col items-start gap-2">
              <button
                type="button"
                className={cx(panicClass, 'h-14 px-10 text-lg')}
                disabled={cram.isPending || scopes.length === 0}
                onClick={start}
              >
                {cram.isPending ? 'Picking cards…' : 'Start'}
              </button>
              {cram.error ? <p className="text-sm text-redpen">{cram.error.message}</p> : null}
            </div>
          </section>
        ) : null}

        {stage.step === 'cards' ? (
          <ReviewSession
            initial={stage.plan.cards}
            docId={docId}
            bookTitles={titles}
            dueNow={0}
            onRestart={() => setStage({ step: 'intro' })}
            finish={
              <div className="flex flex-col items-start gap-2">
                {stage.plan.cards.length === 0 ? (
                  <p className="text-md text-graphite">
                    This book has no flashcards yet, so straight to questions.
                  </p>
                ) : null}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="danger"
                    loading={createQuiz.isPending}
                    onClick={() => toQuestions(stage.plan, stage.endsAt)}
                  >
                    Next: {stage.plan.questionCount} exam questions
                  </Button>
                  <Button variant="ghost" onClick={() => setStage({ step: 'done' })}>
                    Skip to the end
                  </Button>
                </div>
                {createQuiz.isPending ? (
                  <p className="text-sm text-graphite">
                    Picking questions. New ones take a minute if the book has few.
                  </p>
                ) : null}
                {createQuiz.error ? <p className="text-sm text-redpen">{createQuiz.error.message}</p> : null}
              </div>
            }
          />
        ) : null}

        {stage.step === 'questions' ? (
          <QuizRunner
            key={stage.session.id}
            session={stage.session}
            reveal="instant"
            onCitation={(page) => void navigate(`/book/${encodeURIComponent(docId)}?page=${page}`)}
            newLabel="Finish"
            onNew={() => setStage({ step: 'done' })}
            onRetry={(session) => setStage({ ...stage, session })}
          />
        ) : null}

        {stage.step === 'done' ? (
          <section aria-label="Cram finished" className="flex max-w-prose flex-col items-start gap-4 py-4">
            <h2 className="font-serif text-2xl font-semibold">That’s it. Go to sleep.</h2>
            <p className="text-md">
              Sleep does more for tomorrow’s score than another hour of cards: it is when today’s learning
              sticks. Anything you got wrong is in “My mistakes” for a quick look over breakfast.
            </p>
            <div className="flex flex-wrap gap-2">
              <Link to={`/review?book=${encodeURIComponent(docId)}`} className={buttonClass('secondary')}>
                Look at my mistakes
              </Link>
              <Button variant="ghost" onClick={() => setStage({ step: 'intro' })}>
                One more round
              </Button>
              <Link to={`/book/${encodeURIComponent(docId)}`} className={buttonClass('ghost')}>
                Back to the book
              </Link>
            </div>
          </section>
        ) : null}
      </div>
    </div>
  )
}
