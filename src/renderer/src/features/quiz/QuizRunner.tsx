import { useRef, useState } from 'react'
import type { QuizSession } from '@shared/domain'
import { Button, cx, Dialog, Spinner } from '../../components'
import { ExamTimer } from './ExamTimer'
import { ActionButton } from './question/ActionButton'
import { QuestionView } from './question/QuestionView'
import { ReportDialog } from './question/ReportDialog'
import { choiceLabels, MAX_CHOICE_KEYS, toResponse } from './question/response'
import { useQuestionKeys } from './question/useQuestionKeys'
import { QuizResults } from './QuizResults'
import { countedIds } from './run'
import type { RevealMode } from './run'
import { useQuizRun } from './useQuizRun'

interface QuizRunnerProps {
  session: QuizSession
  reveal: RevealMode
  onCitation: (page: number) => void
  onNew: () => void
  onRetry: (session: QuizSession) => void
}

/** Numbered chips to move around an exam; answered questions are filled in. */
function Navigator({
  ids,
  index,
  answered,
  onGo
}: {
  ids: string[]
  index: number
  answered: (id: string) => boolean
  onGo: (index: number) => void
}): React.JSX.Element {
  return (
    <nav aria-label="Questions" className="flex flex-wrap gap-1.5">
      {ids.map((id, i) => (
        <button
          key={id}
          type="button"
          onClick={() => onGo(i)}
          aria-current={i === index ? 'step' : undefined}
          aria-label={`Question ${i + 1}${answered(id) ? ', answered' : ''}`}
          className={cx(
            'tabular inline-flex size-8 items-center justify-center rounded-md border text-sm font-semibold transition-colors',
            i === index
              ? 'border-ink bg-ink text-paper'
              : answered(id)
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-rule text-graphite hover:border-rule-strong'
          )}
        >
          {i + 1}
        </button>
      ))}
    </nav>
  )
}

/** Runs a quiz: instant feedback after each answer, or exam mode with a timer and marks at the end. */
export function QuizRunner({
  session,
  reveal,
  onCitation,
  onNew,
  onRetry
}: QuizRunnerProps): React.JSX.Element {
  const run = useQuizRun(session, reveal)
  const primary = useRef<HTMLButtonElement>(null)
  const [reporting, setReporting] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { state, question, draft } = run
  const exam = reveal === 'end'
  const counted = countedIds(state)
  const answered = (id: string): boolean => {
    const d = state.drafts[id]
    return state.results[id] !== undefined || (d !== undefined && toResponse(d) !== null)
  }
  const unanswered = counted.filter((id) => !answered(id)).length
  const handIn = (): void => {
    if (unanswered > 0) setConfirming(true)
    else run.handIn()
  }

  const onEnter = (): void => {
    if (exam) {
      if (run.isLast) handIn()
      else run.advance()
    } else if (state.phase === 'answering') run.check()
    else run.advance()
  }

  useQuestionKeys(
    {
      choices:
        state.phase === 'answering' && question
          ? Math.min(MAX_CHOICE_KEYS, choiceLabels(question).length)
          : 0,
      holdDigits: true,
      canReport: question !== null,
      onChoice: run.pick,
      onEnter,
      onReport: () => question && setReporting(question.id)
    },
    (state.phase === 'answering' || state.phase === 'checking' || state.phase === 'feedback') &&
      reporting === null &&
      !confirming
  )

  if (state.phase === 'done' && state.result) {
    return (
      <QuizResults
        session={session}
        result={state.result}
        state={state}
        onCitation={onCitation}
        onNew={onNew}
        onRetry={onRetry}
      />
    )
  }
  if (state.phase === 'handing_in') {
    const marked = Object.keys(state.results).length
    return (
      <div role="status" className="flex flex-col gap-3 py-10">
        <p className="flex items-center gap-2 font-serif text-lg">
          <Spinner size={18} /> Marking your answers…
        </p>
        {exam ? (
          <p className="tabular text-sm text-graphite">
            {marked} of {counted.length} marked
          </p>
        ) : null}
      </div>
    )
  }
  if (!question || !draft) {
    return <p className="text-graphite">This quiz has no questions.</p>
  }

  const feedback = state.phase === 'feedback'
  const label = exam
    ? run.isLast
      ? 'Hand in'
      : 'Next question'
    : feedback
      ? run.isLast
        ? 'See results'
        : 'Next question'
      : 'Check'
  const action = exam ? onEnter : feedback ? run.advance : run.check

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-rule pb-4">
        {exam ? (
          <Navigator ids={state.ids} index={state.index} answered={answered} onGo={run.goto} />
        ) : (
          <p className="tabular text-sm text-graphite">
            {Object.keys(state.results).length} of {counted.length} answered
          </p>
        )}
        <span className="ml-auto flex items-center gap-3">
          {exam && session.timeLimit ? <ExamTimer minutes={session.timeLimit} onExpire={run.handIn} /> : null}
          {exam ? (
            <Button variant="secondary" onClick={handIn}>
              Hand in
            </Button>
          ) : (
            <Button variant="ghost" onClick={handIn}>
              Finish now
            </Button>
          )}
        </span>
      </div>

      <QuestionView
        question={question}
        number={state.index + 1}
        total={state.ids.length}
        draft={draft}
        onDraft={run.setDraft}
        result={run.shownResult}
        locked={state.phase !== 'answering'}
        onSubmit={onEnter}
        onReport={() => setReporting(question.id)}
        primaryRef={primary}
        onCitation={onCitation}
        size="page"
        actions={
          <>
            {exam && state.index > 0 ? (
              <Button onClick={() => run.goto(state.index - 1)}>Previous</Button>
            ) : null}
            <ActionButton
              ref={primary}
              label={label}
              onClick={action}
              disabled={!exam && !feedback && !run.ready}
              loading={state.phase === 'checking'}
            />
            {exam ? (
              <span className="text-sm text-graphite">Answers are marked when you hand in.</span>
            ) : null}
            {state.error ? (
              <p role="alert" className="text-sm text-redpen">
                Could not mark the answer: {state.error}
              </p>
            ) : null}
          </>
        }
      />

      <ReportDialog questionId={reporting} onClose={() => setReporting(null)} onReported={run.reported} />
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`${unanswered} question${unanswered === 1 ? ' has' : 's have'} no answer`}
        description="Unanswered questions score 0. Hand in anyway?"
        actions={
          <>
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Keep going
            </Button>
            <Button
              variant="primary"
              onClick={() => {
                setConfirming(false)
                run.handIn()
              }}
            >
              Hand in
            </Button>
          </>
        }
      />
    </div>
  )
}
