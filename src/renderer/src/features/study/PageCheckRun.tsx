import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import type { QuizResult, QuizSession } from '@shared/domain'
import { useTopics } from '../../api/hooks'
import { Button, EmptyState, Icon, Spinner } from '../../components'
import { topicAt } from '../reader/topicTree'
import { ActionButton } from '../quiz/question/ActionButton'
import { QuestionView } from '../quiz/question/QuestionView'
import { ReportDialog } from '../quiz/question/ReportDialog'
import { choiceLabels, MAX_CHOICE_KEYS } from '../quiz/question/response'
import { useQuestionKeys } from '../quiz/question/useQuestionKeys'
import { Score } from '../quiz/Score'
import { useQuizRun } from '../quiz/useQuizRun'

const noop = (): void => undefined

/** Starts a page check. On a page just checked, main serves questions not answered recently. */
export type StartCheck = (page: number) => void

function summaryLine(result: QuizResult): string {
  const ratio = result.maxScore > 0 ? result.score / result.maxScore : 0
  if (ratio >= 0.999) return 'All right. This page is in good shape.'
  if (ratio >= 0.5) return 'Mostly there. Have another look at what you missed.'
  return 'Worth another read before you move on.'
}

function Summary({
  docId,
  page,
  readerPage,
  result,
  onStart,
  onCitation
}: {
  docId: string
  page: number
  readerPage: number
  result: QuizResult
  onStart: StartCheck
  onCitation: (page: number) => void
}): React.JSX.Element {
  const topics = useTopics(docId)
  const topic = topicAt(topics.data ?? [], page)
  const primary = useRef<HTMLButtonElement>(null)
  const moved = readerPage !== page
  const next = (): void => onStart(moved ? readerPage : page)
  useQuestionKeys({
    choices: 0,
    holdDigits: false,
    canReport: false,
    onChoice: noop,
    onReport: noop,
    onEnter: next
  })
  useEffect(() => primary.current?.focus({ preventScroll: true }), [])

  return (
    <section aria-label={`Page ${page} check results`} className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Score score={result.score} max={result.maxScore} />
        <p className="font-serif text-lg leading-snug text-ink">{summaryLine(result)}</p>
      </div>
      <p aria-live="polite" className="sr-only">
        You got {result.score} of {result.maxScore} right.
      </p>
      {result.reviewPages.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-graphite">Re-read</h3>
          <ul className="flex flex-wrap gap-2">
            {result.reviewPages.map((p) => (
              <li key={p}>
                <Button size="sm" icon="file" onClick={() => onCitation(p)}>
                  Page {p}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          ref={primary}
          label={moved ? `Test me on page ${readerPage}` : 'New questions'}
          onClick={next}
        />
        {moved ? <Button onClick={() => onStart(page)}>New questions on page {page}</Button> : null}
      </div>
      <Link
        to={
          topic
            ? `/book/${encodeURIComponent(docId)}/quiz?topic=${encodeURIComponent(topic.id)}`
            : `/book/${encodeURIComponent(docId)}/quiz`
        }
        className="inline-flex items-center gap-1.5 self-start text-sm font-semibold text-accent hover:underline"
      >
        <Icon name="target" size={16} />
        {topic ? `Longer quiz on ${topic.title}` : 'Quiz on the whole book'}
      </Link>
    </section>
  )
}

interface PageCheckRunProps {
  session: QuizSession
  /** The page the reader is on now (it may have moved since the check started). */
  readerPage: number
  onStart: StartCheck
  onCitation: (page: number) => void
}

/** A running page check: one question at a time with instant feedback, then a short summary. */
export function PageCheckRun({
  session,
  readerPage,
  onStart,
  onCitation
}: PageCheckRunProps): React.JSX.Element {
  const run = useQuizRun(session, 'instant')
  const primary = useRef<HTMLButtonElement>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const { state, question, draft } = run
  const page = session.scope.kind === 'page' ? session.scope.page : readerPage
  const active = state.phase === 'answering' || state.phase === 'checking' || state.phase === 'feedback'

  useQuestionKeys(
    {
      choices:
        state.phase === 'answering' && question
          ? Math.min(MAX_CHOICE_KEYS, choiceLabels(question).length)
          : 0,
      holdDigits: true,
      canReport: question !== null,
      onChoice: run.pick,
      onEnter: () => (state.phase === 'answering' ? run.check() : run.advance()),
      onReport: () => question && setReporting(question.id)
    },
    active && reporting === null
  )

  if (state.phase === 'done') {
    return state.result ? (
      <Summary
        docId={session.docId}
        page={page}
        readerPage={readerPage}
        result={state.result}
        onStart={onStart}
        onCitation={onCitation}
      />
    ) : (
      <EmptyState
        size="sm"
        icon="target"
        title={`Nothing to ask about page ${page}`}
        actions={
          readerPage !== page ? (
            <Button size="sm" onClick={() => onStart(readerPage)}>
              Test me on page {readerPage}
            </Button>
          ) : null
        }
      >
        This page has no content worth testing, such as a title or contents page.
      </EmptyState>
    )
  }
  if (state.phase === 'handing_in' || !question || !draft) {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-graphite">
        <Spinner size={14} /> Adding up your score…
      </p>
    )
  }

  const feedback = state.phase === 'feedback'
  return (
    <>
      <QuestionView
        question={question}
        number={state.index + 1}
        total={state.ids.length}
        draft={draft}
        onDraft={run.setDraft}
        result={run.shownResult}
        locked={state.phase !== 'answering'}
        onSubmit={run.check}
        onReport={() => setReporting(question.id)}
        primaryRef={primary}
        onCitation={onCitation}
        meta={
          <button
            type="button"
            onClick={() => onCitation(page)}
            className="tabular rounded-sm px-1 text-sm text-graphite hover:text-ink"
            aria-label={`Questions about page ${page}. Go to page ${page}`}
          >
            p. {page}
          </button>
        }
        actions={
          <>
            <ActionButton
              ref={primary}
              label={feedback ? (run.isLast ? 'See my score' : 'Next question') : 'Check'}
              onClick={feedback ? run.advance : run.check}
              disabled={!feedback && !run.ready}
              loading={state.phase === 'checking'}
            />
            {state.error ? (
              <p role="alert" className="text-sm text-redpen">
                Could not mark this answer: {state.error}
              </p>
            ) : null}
          </>
        }
      />
      <ReportDialog questionId={reporting} onClose={() => setReporting(null)} onReported={run.reported} />
    </>
  )
}
