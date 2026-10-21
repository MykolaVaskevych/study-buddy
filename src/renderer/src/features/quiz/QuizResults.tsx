import { Link } from 'react-router'
import type { QuizResult, QuizSession } from '@shared/domain'
import { useCreateQuiz, useTopicsOf } from '../../api/hooks'
import { Button, buttonClass, cx, Icon, Markdown, Progress } from '../../components'
import { verdictOf } from './question/Feedback'
import { describeResponse, toResponse } from './question/response'
import type { RunState } from './run'
import { formatScore, Score, scoreTone } from './Score'

interface QuizResultsProps {
  session: QuizSession
  result: QuizResult
  state: RunState
  onCitation: (page: number) => void
  onNew: () => void
  /** Label of the onNew button (default "New quiz"). */
  newLabel?: string
  onRetry: (session: QuizSession) => void
}

function headline(ratio: number): string {
  if (ratio >= 0.9) return 'Excellent. You know this well.'
  if (ratio >= 0.7) return 'Solid. A few points to tighten.'
  if (ratio >= 0.4) return 'Getting there. Re-read the pages below, then retry your mistakes.'
  return 'This needs another pass. Start with the pages below.'
}

/** Score, per-topic breakdown, pages to re-read, every missed question explained, and next steps. */
export function QuizResults({
  session,
  result,
  state,
  onCitation,
  onNew,
  newLabel = 'New quiz',
  onRetry
}: QuizResultsProps): React.JSX.Element {
  // A cram's quiz can span several files of a course.
  const docIds = [...new Set([session.docId, ...session.questions.map((q) => q.docId)])]
  const topics = useTopicsOf(docIds)
  const retry = useCreateQuiz()
  const titles = new Map(topics.map((t) => [t.id, t.title]))
  const ratio = result.maxScore > 0 ? result.score / result.maxScore : 0
  const byId = new Map(session.questions.map((q) => [q.id, q]))
  const missed = result.attempts
    .filter((a) => !a.correct)
    .flatMap((a) => {
      const q = byId.get(a.questionId)
      return q ? [{ q, a }] : []
    })
  const unanswered = session.questions.filter(
    (q) => !state.skipped.includes(q.id) && !result.attempts.some((a) => a.questionId === q.id)
  )
  const toRetry = missed.length + unanswered.length

  return (
    <div className="flex flex-col gap-9">
      <section aria-label="Score" className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <Score score={result.score} max={result.maxScore} size="lg" />
        <div className="flex max-w-[44ch] flex-col gap-1">
          <h2 className="font-serif text-xl font-semibold">
            {formatScore(result.score)} of {result.maxScore} right ({Math.round(ratio * 100)}%)
          </h2>
          <p className="text-md text-graphite">{headline(ratio)}</p>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {toRetry > 0 ? (
          <Button
            variant="primary"
            icon="review"
            loading={retry.isPending}
            onClick={() =>
              retry.mutate(
                {
                  scope: session.scope,
                  mode: 'review_mistakes',
                  count: Math.min(60, Math.max(1, toRetry)),
                  types: null,
                  timeLimit: null
                },
                { onSuccess: onRetry }
              )
            }
          >
            Retry mistakes
          </Button>
        ) : null}
        <Button onClick={onNew}>{newLabel}</Button>
        <Link to={`/book/${encodeURIComponent(session.docId)}`} className={buttonClass('ghost')}>
          Back to the book
        </Link>
      </div>

      {result.perTopic.length > 1 || (result.perTopic[0]?.topicId ?? null) !== null ? (
        <section aria-labelledby="by-topic" className="flex flex-col gap-3">
          <h3 id="by-topic" className="text-sm font-semibold text-graphite">
            By topic
          </h3>
          <ul className="flex flex-col gap-3">
            {[...result.perTopic]
              .sort((a, b) => a.score / (a.maxScore || 1) - b.score / (b.maxScore || 1))
              .map((t) => {
                const r = t.maxScore > 0 ? t.score / t.maxScore : 0
                const title = t.topicId ? (titles.get(t.topicId) ?? 'Topic') : 'Other questions'
                return (
                  <li
                    key={t.topicId ?? 'none'}
                    className="grid grid-cols-[minmax(0,1fr)_8rem_3.5rem] items-center gap-4"
                  >
                    <span className="truncate">{title}</span>
                    <Progress
                      value={r}
                      label={title}
                      valueText={`${formatScore(t.score)} of ${t.maxScore}`}
                      tone={scoreTone(r)}
                      size="xs"
                    />
                    <span className="tabular text-right text-sm text-graphite">
                      {formatScore(t.score)}/{t.maxScore}
                    </span>
                  </li>
                )
              })}
          </ul>
        </section>
      ) : null}

      {result.reviewPages.length > 0 ? (
        <section aria-labelledby="review-pages" className="flex flex-col gap-3">
          <h3 id="review-pages" className="text-sm font-semibold text-graphite">
            Review these pages
          </h3>
          <ul className="flex flex-wrap gap-2">
            {result.reviewPages.map((p) => (
              <li key={p}>
                <Link
                  to={`/book/${encodeURIComponent(session.docId)}?page=${p}`}
                  className={cx(buttonClass('secondary', 'sm'), 'tabular')}
                >
                  <Icon name="file" size={14} /> Page {p}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {missed.length > 0 ? (
        <section aria-labelledby="missed" className="flex flex-col gap-4">
          <h3 id="missed" className="text-sm font-semibold text-graphite">
            What you missed
          </h3>
          <ol className="flex flex-col gap-4">
            {missed.map(({ q, a }) => {
              const draft = state.drafts[q.id]
              const partial = verdictOf(a) === 'partial'
              return (
                <li key={q.id} className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-5">
                  <Markdown onCitation={onCitation} className="text-md">
                    {q.stem}
                  </Markdown>
                  <dl className="grid grid-cols-[8rem_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                    <dt className="text-graphite">Your answer</dt>
                    <dd className={partial ? 'text-ink' : 'text-redpen'}>
                      <Markdown inline>{describeResponse(q, draft ? toResponse(draft) : null)}</Markdown>
                      {partial ? ` (${Math.round(a.score * 100)}%)` : ''}
                    </dd>
                    <dt className="text-graphite">
                      {q.type === 'short' ? 'Model answer' : 'Correct answer'}
                    </dt>
                    <dd>
                      <Markdown onCitation={onCitation} className="text-sm">
                        {a.correctAnswer}
                      </Markdown>
                    </dd>
                    {a.missingPoints.length > 0 ? (
                      <>
                        <dt className="text-graphite">Missing</dt>
                        <dd>{a.missingPoints.join('; ')}</dd>
                      </>
                    ) : null}
                  </dl>
                  {a.feedback ? <p className="text-sm text-graphite">{a.feedback}</p> : null}
                  <Markdown onCitation={onCitation} className="text-sm text-graphite">
                    {q.explanation}
                  </Markdown>
                </li>
              )
            })}
          </ol>
        </section>
      ) : null}

      {unanswered.length > 0 ? (
        <p className="text-sm text-graphite">
          {unanswered.length} question{unanswered.length === 1 ? ' was' : 's were'} left unanswered and scored
          0.
        </p>
      ) : null}
    </div>
  )
}
