import { useState } from 'react'
import { Link, useParams } from 'react-router'
import type { BookOverview, Topic } from '@shared/domain'
import { useOverview, usePrepare, useResetProgress, useTopics } from '../../api/hooks'
import { useToasts } from '../../app/toasts'
import { Button, Dialog, EmptyState, Icon, Progress, Skeleton, Spinner, cx } from '../../components'
import { useAutoTour } from '../tour/useAutoTour'

type StepState = 'done' | 'working' | 'todo'

function StepIcon({ state }: { state: StepState }): React.JSX.Element {
  if (state === 'done') return <Icon name="check" size={18} className="text-ok" />
  if (state === 'working') return <Spinner size={16} />
  return <span aria-hidden className="inline-block size-4 rounded-full border-2 border-rule-strong" />
}

function Step({
  state,
  title,
  detail,
  children
}: {
  state: StepState
  title: string
  detail: string
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <li className="flex gap-3 py-3">
      <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center">
        <StepIcon state={state} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">
          {title}
          <span className="sr-only">
            {' '}
            ({state === 'done' ? 'ready' : state === 'working' ? 'in progress' : 'not yet'})
          </span>
        </p>
        <p className="text-sm text-graphite">{detail}</p>
        {children}
      </div>
    </li>
  )
}

/** The AI side: what has been read and prepared, and what is running now. */
function AiChecklist({ o }: { o: BookOverview }): React.JSX.Element {
  const reading =
    o.index.state === 'done'
      ? 'done'
      : o.index.state === 'running' || o.index.state === 'queued'
        ? 'working'
        : 'todo'
  const map = o.topics.state === 'ready' ? 'done' : o.topics.state === 'building' ? 'working' : 'todo'
  const cardsWorking = o.jobs.some((j) => j.kind === 'generate_cards')
  const cards: StepState =
    o.cards.topicsTotal > 0 && o.cards.topicsCovered >= o.cards.topicsTotal
      ? 'done'
      : cardsWorking
        ? 'working'
        : 'todo'
  return (
    <ol className="divide-y divide-rule">
      <Step
        state={reading}
        title="Read every page"
        detail={`${o.index.indexedPages} of ${o.index.totalPages} pages have AI notes${o.index.state === 'paused' ? ' (paused)' : ''}.`}
      >
        {reading !== 'done' ? (
          <Progress
            value={o.index.totalPages ? o.index.indexedPages / o.index.totalPages : 0}
            label="Pages read"
          />
        ) : null}
      </Step>
      <Step
        state={map}
        title="Course map"
        detail={
          map === 'done'
            ? `${o.topics.count} topics with exam weights and time estimates.`
            : map === 'working'
              ? 'Building topics and exam estimates…'
              : 'Built automatically once every page is read.'
        }
      />
      <Step
        state={o.plan.saved ? 'done' : 'todo'}
        title="Exam plan"
        detail={
          o.plan.saved
            ? `Exam ${o.plan.examDate ?? 'date not set'}; expected about ${Math.round((o.plan.expectedScore ?? 0) * 100)} %.`
            : 'Not set yet: tell the planner your exam date and hours.'
        }
      >
        <Link to={`/book/${o.docId}/plan`} className="text-sm text-accent hover:underline">
          {o.plan.saved ? 'Open the plan' : 'Make a plan'}
        </Link>
      </Step>
      <Step
        state={cards}
        title="Essentials flashcards"
        detail={`${o.cards.total} cards; essentials ready for ${o.cards.topicsCovered} of ${o.cards.topicsTotal} topics. ${o.cards.due} due now.`}
      />
      <Step
        state={o.questions.pageChecksReady > 0 ? 'done' : 'todo'}
        title="Quick tests"
        detail={`${o.questions.total} questions made; ${o.questions.pageChecksReady} ${o.questions.pageChecksReady === 1 ? 'page has' : 'pages have'} a "Test me" ready. More are prepared while you read.`}
      />
    </ol>
  )
}

/** What "Prepare everything" would still do, so the cost in AI usage is clear before clicking. */
function PrepareHint({ o }: { o: BookOverview }): React.JSX.Element {
  const decks = Math.max(0, o.cards.topicsTotal - o.cards.topicsCovered)
  const text =
    o.index.state !== 'done'
      ? 'Reads the rest of the book first (cheap), then the course map and flashcards.'
      : o.topics.state !== 'ready'
        ? 'Builds the course map, then essentials flashcards.'
        : decks === 0
          ? 'Everything is prepared.'
          : `About ${decks} AI request${decks === 1 ? '' : 's'} (one per topic; skipped topics are left out).`
  return <p className="w-full text-right text-sm text-graphite">{text}</p>
}

/** Topic table with mastery and a per-topic reset. */
function TopicProgress({
  docId,
  topics,
  onReset
}: {
  docId: string
  topics: Topic[]
  onReset: (topic: Topic) => void
}): React.JSX.Element {
  return (
    <ul className="divide-y divide-rule">
      {topics.map((t) => (
        <li key={t.id} className={cx('flex items-center gap-3 py-2', t.parentId === null && 'font-semibold')}>
          <Link to={`/book/${docId}?page=${t.pageStart}`} className="min-w-0 flex-1 truncate hover:underline">
            {t.title}
          </Link>
          <span className="tabular w-24 text-right text-sm text-graphite">
            {t.mastery === null ? 'not studied' : `${Math.round(t.mastery * 100)} % mastery`}
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => onReset(t)}
            aria-label={`Reset progress for ${t.title}`}
          >
            Reset
          </Button>
        </li>
      ))}
    </ul>
  )
}

/**
 * Route /book/:docId/overview: what the AI has done for this book and what is left, one button to
 * prepare everything, and the student's own progress with resets.
 */
export function OverviewScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const overview = useOverview(docId)
  const topics = useTopics(docId)
  const prepare = usePrepare()
  const reset = useResetProgress()
  const push = useToasts((t) => t.push)
  const [confirm, setConfirm] = useState<{ topic: Topic | null } | null>(null)
  useAutoTour('overview', overview.isSuccess)
  const o = overview.data

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-8 px-8 py-8">
        <header className="flex flex-wrap items-end gap-4">
          <div className="min-w-0 flex-1">
            <Link to={`/book/${docId}`} className="text-sm text-graphite hover:text-ink">
              ← Back to the book
            </Link>
            <h1 className="font-serif text-2xl font-semibold">{o?.title ?? 'Overview'}</h1>
          </div>
          <Button
            data-tour="prepare"
            variant="primary"
            icon="sparkle"
            loading={prepare.isPending}
            disabled={!o || o.preparing}
            onClick={() =>
              prepare.mutate(
                { docId },
                { onSuccess: (r) => push({ tone: 'ok', title: 'Preparing', body: r.message }) }
              )
            }
          >
            {o?.preparing ? 'Preparing…' : 'Prepare everything'}
          </Button>
          {o && !o.preparing ? <PrepareHint o={o} /> : null}
        </header>

        {!o ? (
          overview.isError ? (
            <EmptyState icon="alert" title="Overview did not load">
              {overview.error.message}
            </EmptyState>
          ) : (
            <Skeleton className="h-64" />
          )
        ) : (
          <>
            <section data-tour="ai-status" className="rounded-lg border border-rule bg-sheet p-5">
              <h2 className="mb-1 font-serif text-lg font-semibold">What the AI has prepared</h2>
              <p className="mb-2 text-sm text-graphite">
                "Prepare everything" reads the whole book, builds the course map, then makes essentials
                flashcards for every topic your plan doesn&apos;t skip. Finished steps are skipped, and you
                can keep studying while it works.
              </p>
              <AiChecklist o={o} />
              {o.jobs.length > 0 ? (
                <div className="mt-3 rounded-md bg-sunken p-3">
                  <p className="mb-1 text-sm font-semibold">Working on now</p>
                  <ul className="text-sm text-graphite">
                    {o.jobs.slice(0, 6).map((j) => (
                      <li key={j.id}>
                        {j.label}
                        {j.state === 'running' ? ` · ${Math.round(j.progress * 100)} %` : ' · waiting'}
                      </li>
                    ))}
                    {o.jobs.length > 6 ? <li>…and {o.jobs.length - 6} more</li> : null}
                  </ul>
                </div>
              ) : null}
            </section>

            <section data-tour="my-progress" className="rounded-lg border border-rule bg-sheet p-5">
              <div className="mb-3 flex flex-wrap items-baseline gap-3">
                <h2 className="flex-1 font-serif text-lg font-semibold">Your progress</h2>
                <Button size="sm" variant="secondary" onClick={() => setConfirm({ topic: null })}>
                  Reset book progress
                </Button>
              </div>
              <dl className="mb-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  ['Pages read', `${o.progress.pagesRead} / ${o.pageCount}`],
                  ['Reading time', `${o.progress.minutesRead} min`],
                  ['Cards reviewed', String(o.progress.reviews)],
                  ['Quizzes done', String(o.progress.quizzes)]
                ].map(([k, v]) => (
                  <div key={k} className="rounded-md bg-sunken p-3">
                    <dt className="text-graphite">{k}</dt>
                    <dd className="tabular text-lg font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              {topics.data && topics.data.length > 0 ? (
                <TopicProgress docId={docId} topics={topics.data} onReset={(t) => setConfirm({ topic: t })} />
              ) : (
                <p className="text-sm text-graphite">
                  Per-topic progress appears once the course map is built.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        title={confirm?.topic ? `Reset “${confirm.topic.title}”?` : 'Reset progress for the whole book?'}
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={reset.isPending}
              onClick={() =>
                reset.mutate(
                  { docId, topicId: confirm?.topic?.id ?? null },
                  {
                    onSuccess: (r) => {
                      setConfirm(null)
                      push({
                        tone: 'ok',
                        title: 'Progress reset',
                        body: `${r.cards} cards back to new, ${r.attempts} answers and ${r.readingPages} pages of reading cleared.`
                      })
                    }
                  }
                )
              }
            >
              Reset
            </Button>
          </>
        }
      >
        <p className="mb-4 text-[0.95rem]">
          This clears your reviews (cards start again as new), quiz answers, mastery and reading time
          {confirm?.topic ? ' for this topic' : ''}. Everything the AI made (notes, cards, questions, course
          map) stays.
        </p>
      </Dialog>
    </div>
  )
}
