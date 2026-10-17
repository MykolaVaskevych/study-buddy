import type { ReactNode } from 'react'
import type { AttemptResult, Question } from '@shared/domain'
import { cx, Icon, Markdown } from '../../../components'
import { choiceLabels, optionMark } from './response'
import type { Draft } from './response'

export type VerdictKind = 'correct' | 'partial' | 'wrong'

export function verdictOf(result: AttemptResult): VerdictKind {
  if (result.correct) return 'correct'
  return result.score > 0 ? 'partial' : 'wrong'
}

const pct = (score: number): string => `${Math.round(score * 100)}%`

/** One sentence for screen readers, announced through the question's live region. */
export function verdictSentence(result: AttemptResult): string {
  const kind = verdictOf(result)
  if (kind === 'correct') return 'Correct.'
  if (kind === 'partial') return `Partly right, ${pct(result.score)}.`
  return 'Not quite.'
}

function Verdict({ result }: { result: AttemptResult }): React.JSX.Element {
  const kind = verdictOf(result)
  const tone = kind === 'correct' ? 'text-ok' : kind === 'partial' ? 'text-ink' : 'text-redpen'
  return (
    <p
      data-verdict
      className={cx('flex scroll-mb-6 items-center gap-2.5 font-serif text-xl font-semibold', tone)}
    >
      <span
        aria-hidden
        className={cx(
          'inline-flex size-8 items-center justify-center rounded-full border-2',
          kind === 'correct' ? 'border-ok' : kind === 'partial' ? 'border-ink' : 'border-redpen'
        )}
      >
        <Icon name={kind === 'wrong' ? 'close' : 'check'} size={18} />
      </span>
      {kind === 'correct'
        ? 'Correct'
        : kind === 'partial'
          ? `Partly right, ${pct(result.score)}`
          : 'Not quite'}
    </p>
  )
}

function Part({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <h4 className="text-sm font-semibold text-graphite">{title}</h4>
      {children}
    </div>
  )
}

interface FeedbackProps {
  question: Question
  draft: Draft
  result: AttemptResult
  onCitation?: (page: number) => void
}

/**
 * What the person needs after answering: the verdict, the right answer, what was missing, the
 * explanation with page citations, and why each option is right or wrong.
 */
export function Feedback({ question, draft, result, onCitation }: FeedbackProps): React.JSX.Element {
  const kind = verdictOf(result)
  const options = choiceLabels(question)
  const rationales = question.optionRationales
  const answerTitle =
    question.type === 'short'
      ? 'Model answer'
      : question.type === 'multi'
        ? 'Correct answers'
        : 'Correct answer'
  return (
    <section aria-label="Feedback" className="flex flex-col gap-4 border-t border-rule pt-4">
      <Verdict result={result} />
      {result.feedback ? (
        <Markdown className="text-graphite" onCitation={onCitation}>
          {result.feedback}
        </Markdown>
      ) : null}
      {kind !== 'correct' && question.type !== 'tf' ? (
        <Part title={answerTitle}>
          <Markdown onCitation={onCitation}>{result.correctAnswer}</Markdown>
        </Part>
      ) : null}
      {result.missingPoints.length > 0 ? (
        <Part title={question.type === 'multi' ? 'You missed' : 'Missing from your answer'}>
          <ul className="prose-study flex flex-col gap-1">
            {result.missingPoints.map((p) => (
              <li key={p} className="flex gap-2.5">
                <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-redpen" />
                <Markdown inline onCitation={onCitation}>
                  {p}
                </Markdown>
              </li>
            ))}
          </ul>
        </Part>
      ) : null}
      {question.explanation ? (
        <Part title="Why">
          <Markdown onCitation={onCitation}>{question.explanation}</Markdown>
        </Part>
      ) : null}
      {rationales && rationales.length === options.length ? (
        <Part title="Each option">
          <ol className="flex flex-col gap-2">
            {rationales.map((why, i) => {
              const mark = optionMark(question, draft, i)
              const good = mark === 'right' || mark === 'missed'
              return (
                <li key={i} className="flex gap-2.5 text-sm">
                  <span
                    aria-hidden
                    className={cx(
                      'tabular mt-px inline-flex size-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold',
                      good
                        ? 'bg-ok-soft text-ok'
                        : mark === 'wrong'
                          ? 'bg-redpen-soft text-redpen'
                          : 'bg-sunken text-graphite'
                    )}
                  >
                    {i + 1}
                  </span>
                  <span className="sr-only">Option {i + 1}:</span>
                  <Markdown inline className="min-w-0 flex-1 text-graphite" onCitation={onCitation}>
                    {why}
                  </Markdown>
                </li>
              )
            })}
          </ol>
        </Part>
      ) : null}
    </section>
  )
}
