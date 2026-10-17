import type { Ref } from 'react'
import type { Question } from '@shared/domain'
import { cx, Icon, Markdown } from '../../../components'
import { choiceLabels, isChosen, MAX_CHOICE_KEYS, optionMark } from './response'
import type { Draft, OptionMark } from './response'

interface ChoiceListProps {
  question: Question
  draft: Draft
  /** Answer is in: inputs are disabled. */
  locked: boolean
  /** Show right / wrong marks (instant feedback, or results after an exam). */
  marked: boolean
  onPick: (index: number) => void
  /** Id of the question stem, which names the group. */
  labelledBy: string
  fieldRef?: Ref<HTMLFieldSetElement>
}

const markClass: Record<Exclude<OptionMark, null>, string> = {
  right: 'border-ok bg-ok-soft',
  wrong: 'border-redpen bg-redpen-soft',
  missed: 'border-ok border-dashed'
}

const markText: Record<Exclude<OptionMark, null>, string> = {
  right: 'Your answer, correct',
  wrong: 'Your answer, wrong',
  missed: 'Correct answer'
}

/** A teacher's mark in the margin: a green tick or a red cross. The slot is always there. */
function Mark({ mark }: { mark: OptionMark }): React.JSX.Element {
  return (
    <span className="mt-0.5 inline-flex size-5 shrink-0 items-center justify-center">
      {mark ? (
        <>
          <Icon
            name={mark === 'wrong' ? 'close' : 'check'}
            size={18}
            className={mark === 'wrong' ? 'text-redpen' : 'text-ok'}
          />
          <span className="sr-only">{markText[mark]}</span>
        </>
      ) : null}
    </span>
  )
}

/** Options for mcq (radio), multi (checkbox) and true/false. Number keys 1–6 match the key caps. */
export function ChoiceList({
  question,
  draft,
  locked,
  marked,
  onPick,
  labelledBy,
  fieldRef
}: ChoiceListProps): React.JSX.Element {
  const many = question.type === 'multi'
  return (
    <fieldset ref={fieldRef} tabIndex={-1} aria-labelledby={labelledBy} className="min-w-0 outline-none">
      <ul className="flex flex-col gap-2">
        {choiceLabels(question).map((label, i) => {
          const chosen = isChosen(draft, i)
          const mark = marked ? optionMark(question, draft, i) : null
          return (
            <li key={i}>
              <label
                className={cx(
                  'flex items-start gap-3 rounded-md border px-3 py-2.5 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  mark
                    ? markClass[mark]
                    : chosen
                      ? 'border-accent bg-accent-soft'
                      : locked
                        ? 'border-rule bg-sheet opacity-65'
                        : 'cursor-pointer border-rule bg-sheet hover:border-rule-strong'
                )}
              >
                <input
                  type={many ? 'checkbox' : 'radio'}
                  name={question.id}
                  className="sr-only"
                  checked={chosen}
                  disabled={locked}
                  onChange={() => onPick(i)}
                />
                <span
                  aria-hidden
                  className={cx(
                    'tabular mt-px inline-flex size-6 shrink-0 items-center justify-center border text-xs font-semibold',
                    many ? 'rounded-sm' : 'rounded-full',
                    chosen
                      ? 'border-accent bg-accent text-on-accent'
                      : 'border-rule-strong bg-sheet text-graphite'
                  )}
                >
                  {i < MAX_CHOICE_KEYS ? i + 1 : ''}
                </span>
                <span className="min-w-0 flex-1 font-serif text-md leading-snug">
                  <Markdown inline>{label}</Markdown>
                </span>
                <Mark mark={mark} />
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}
