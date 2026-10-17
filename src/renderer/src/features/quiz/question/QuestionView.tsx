import { useEffect, useId, useRef } from 'react'
import type { ReactNode, RefObject } from 'react'
import type { AttemptResult, Question, QuestionType } from '@shared/domain'
import { cx, IconButton, Markdown } from '../../../components'
import { NumericAnswer, ShortAnswer } from './AnswerFields'
import { ChoiceList } from './ChoiceList'
import { Feedback, verdictSentence } from './Feedback'
import { pickChoice } from './response'
import type { Draft } from './response'

export const typeHint: Record<QuestionType, string> = {
  mcq: 'Pick one',
  multi: 'Pick all that apply',
  tf: 'True or false',
  short: 'Answer in a sentence or two',
  numeric: 'Give a number and its unit'
}

const prefersReducedMotion = (): boolean =>
  typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

interface QuestionViewProps {
  question: Question
  /** 1-based position and count, for the header. */
  number: number
  total: number
  draft: Draft
  onDraft: (draft: Draft) => void
  /** Result to show; null hides feedback (not answered yet, or exam mode). */
  result: AttemptResult | null
  locked: boolean
  /** Enter in the number field, Mod+Enter in the text field. */
  onSubmit: () => void
  onReport?: () => void
  /** The action row (Check / Next); it sits between the answer and the feedback so it never moves. */
  actions: ReactNode
  /** Focused once a result arrives, so Enter continues. */
  primaryRef: RefObject<HTMLButtonElement | null>
  onCitation?: (page: number) => void
  size?: 'panel' | 'page'
  /** Extra header content, e.g. the page the question is about. */
  meta?: ReactNode
}

/**
 * One question: header, stem, the answer input for its type, the action row and the feedback.
 * Focus follows the flow: the answer input when a question appears, the primary action once it
 * is marked. The verdict is also announced through a polite live region.
 */
export function QuestionView({
  question,
  number,
  total,
  draft,
  onDraft,
  result,
  locked,
  onSubmit,
  onReport,
  actions,
  primaryRef,
  onCitation,
  size = 'panel',
  meta
}: QuestionViewProps): React.JSX.Element {
  const stemId = useId()
  const fieldRef = useRef<HTMLFieldSetElement>(null)
  const valueRef = useRef<HTMLInputElement>(null)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const feedbackRef = useRef<HTMLDivElement>(null)
  const hasResult = result !== null

  useEffect(() => {
    if (locked) return
    const target =
      question.type === 'numeric'
        ? valueRef.current
        : question.type === 'short'
          ? textRef.current
          : fieldRef.current
    target?.focus({ preventScroll: true })
  }, [question.id, question.type, locked])

  useEffect(() => {
    if (!hasResult) return
    primaryRef.current?.focus({ preventScroll: true })
    // Bring only the verdict into view: the marked options above stay on screen where possible.
    const verdict = feedbackRef.current?.querySelector('[data-verdict]')
    if (verdict && typeof verdict.scrollIntoView === 'function') {
      verdict.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' })
    }
  }, [hasResult, question.id, primaryRef])

  return (
    <article aria-labelledby={stemId} className="flex flex-col gap-5">
      <header className="flex items-center gap-2 text-sm text-graphite">
        <span className="tabular">
          <span className="font-semibold text-ink">Question {number}</span> of {total}
        </span>
        <span aria-hidden className="text-rule-strong">
          /
        </span>
        <span>{typeHint[question.type]}</span>
        <span className="ml-auto flex items-center gap-1">
          {meta}
          {onReport ? (
            <IconButton icon="flag" label="Report this question" shortcut="r" size="sm" onClick={onReport} />
          ) : null}
        </span>
      </header>

      <div id={stemId}>
        <Markdown onCitation={onCitation} className={cx('text-ink', size === 'page' ? 'text-xl' : 'text-lg')}>
          {question.stem}
        </Markdown>
      </div>

      {question.type === 'numeric' && draft.type === 'numeric' ? (
        <NumericAnswer
          draft={draft}
          onChange={onDraft}
          onSubmit={onSubmit}
          locked={locked}
          describedBy={stemId}
          inputRef={valueRef}
        />
      ) : question.type === 'short' && draft.type === 'short' ? (
        <ShortAnswer
          draft={draft}
          onChange={onDraft}
          onSubmit={onSubmit}
          locked={locked}
          labelledBy={stemId}
          inputRef={textRef}
        />
      ) : (
        <ChoiceList
          question={question}
          draft={draft}
          locked={locked}
          marked={hasResult}
          onPick={(i) => onDraft(pickChoice(draft, i))}
          labelledBy={stemId}
          fieldRef={fieldRef}
        />
      )}

      <div className="flex flex-wrap items-center gap-3">{actions}</div>

      <p aria-live="polite" className="sr-only">
        {result ? verdictSentence(result) : ''}
      </p>
      <div ref={feedbackRef}>
        {result ? (
          <Feedback question={question} draft={draft} result={result} onCitation={onCitation} />
        ) : null}
      </div>
    </article>
  )
}
