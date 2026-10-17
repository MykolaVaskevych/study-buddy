import { useState } from 'react'
import type { QuestionType, QuizSession, Scope, Topic } from '@shared/domain'
import { useCreateQuiz } from '../../api/hooks'
import { Button, cx, Spinner } from '../../components'
import { buildTopicTree } from '../reader/topicTree'
import type { TopicNode } from '../reader/topicTree'
import { fieldClass, Segmented } from '../study/form'
import { QuestionSkeleton } from './question/QuestionSkeleton'
import { typeHint } from './question/QuestionView'
import type { RevealMode } from './run'

export type ScopePreset = { kind: 'topic'; topicId: string } | { kind: 'range'; from: number; to: number }

type ScopeKind = 'topic' | 'range' | 'document'

const TYPES: { type: QuestionType; label: string }[] = [
  { type: 'mcq', label: 'Multiple choice' },
  { type: 'multi', label: 'Several answers' },
  { type: 'tf', label: 'True or false' },
  { type: 'numeric', label: 'Calculations' },
  { type: 'short', label: 'Written answers' }
]

const COUNTS = ['5', '10', '20', '40'] as const

function flatten(nodes: TopicNode[], depth = 0): { topic: Topic; depth: number }[] {
  return nodes.flatMap((n) => [{ topic: n.topic, depth }, ...flatten(n.children, depth + 1)])
}

/** Suggested exam time: 1.5 minutes a question, at least 5. */
export function suggestedMinutes(count: number): number {
  return Math.max(5, Math.ceil(count * 1.5))
}

interface QuizSetupProps {
  docId: string
  pageCount: number
  topics: Topic[]
  preset: ScopePreset | null
  onStart: (session: QuizSession, reveal: RevealMode) => void
}

/** Choose what to be quizzed on and how: scope, length, question types, instant or exam mode. */
export function QuizSetup({ docId, pageCount, topics, preset, onStart }: QuizSetupProps): React.JSX.Element {
  const create = useCreateQuiz()
  const ordered = flatten(buildTopicTree(topics))
  const [kind, setKind] = useState<ScopeKind>(preset?.kind ?? (ordered.length > 0 ? 'topic' : 'document'))
  const [topicId, setTopicId] = useState(
    (preset?.kind === 'topic' ? preset.topicId : null) ?? ordered[0]?.topic.id ?? ''
  )
  const [from, setFrom] = useState(String(preset?.kind === 'range' ? preset.from : 1))
  const [to, setTo] = useState(String(preset?.kind === 'range' ? preset.to : Math.min(pageCount, 20)))
  const [count, setCount] = useState<(typeof COUNTS)[number]>('10')
  const [types, setTypes] = useState<QuestionType[]>(TYPES.map((t) => t.type))
  const [mode, setMode] = useState<'instant' | 'exam'>('instant')
  const [minutes, setMinutes] = useState<string | null>(null)

  const n = Number(count)
  const minutesValue = minutes ?? String(suggestedMinutes(n))
  const timeLimit = Number(minutesValue)
  const fromN = Number(from)
  const toN = Number(to)
  const topic = topics.find((t) => t.id === topicId) ?? null
  const rangeOk =
    Number.isInteger(fromN) && Number.isInteger(toN) && fromN >= 1 && toN <= pageCount && fromN <= toN
  const timeOk = mode === 'instant' || (Number.isInteger(timeLimit) && timeLimit >= 1 && timeLimit <= 600)
  const scope: Scope | null =
    kind === 'topic'
      ? topic
        ? { kind: 'topic', docId, topicId: topic.id }
        : null
      : kind === 'range'
        ? rangeOk
          ? { kind: 'range', docId, from: fromN, to: toN }
          : null
        : { kind: 'document', docId }
  const valid = scope !== null && types.length > 0 && timeOk
  const about =
    kind === 'topic' ? (topic?.title ?? '') : kind === 'range' ? `pages ${from}–${to}` : 'the whole book'

  const start = (): void => {
    if (!valid || !scope) return
    create.mutate(
      {
        scope,
        mode: mode === 'exam' ? 'mock' : 'topic',
        count: n,
        types: types.length === TYPES.length ? null : types,
        timeLimit: mode === 'exam' ? timeLimit : null
      },
      { onSuccess: (session) => onStart(session, mode === 'exam' ? 'end' : 'instant') }
    )
  }

  if (create.isPending) {
    return (
      <div aria-busy="true" className="flex flex-col gap-6">
        <p role="status" className="flex items-center gap-2 text-md text-graphite">
          <Spinner size={16} /> Writing {n} questions about {about}. This can take a minute.
        </p>
        <QuestionSkeleton />
      </div>
    )
  }

  const legend = 'text-sm font-semibold text-graphite'
  return (
    <form
      className="flex flex-col gap-7"
      onSubmit={(e) => {
        e.preventDefault()
        start()
      }}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className={cx(legend, 'mb-3')}>Questions about</legend>
        <Segmented
          label="Questions about"
          value={kind}
          onChange={setKind}
          options={[
            { value: 'topic', label: 'A topic', disabled: ordered.length === 0 },
            { value: 'range', label: 'Pages' },
            { value: 'document', label: 'The whole book' }
          ]}
        />
        {kind === 'topic' ? (
          <select
            aria-label="Topic"
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className={cx(fieldClass, 'max-w-xl pr-8')}
          >
            {ordered.map(({ topic: t, depth }) => (
              <option key={t.id} value={t.id}>
                {' '.repeat(depth)}
                {t.title} (pp. {t.pageStart}–{t.pageEnd})
              </option>
            ))}
          </select>
        ) : kind === 'range' ? (
          <div className="flex flex-wrap items-center gap-2 text-sm text-graphite">
            <label className="flex items-center gap-2">
              From page
              <input
                inputMode="numeric"
                value={from}
                onChange={(e) => setFrom(e.target.value.replace(/\D/g, ''))}
                className={cx(fieldClass, 'tabular w-20 text-center')}
              />
            </label>
            <label className="flex items-center gap-2">
              to
              <input
                inputMode="numeric"
                value={to}
                onChange={(e) => setTo(e.target.value.replace(/\D/g, ''))}
                className={cx(fieldClass, 'tabular w-20 text-center')}
              />
            </label>
            {!rangeOk ? (
              <span role="alert" className="text-redpen">
                Pages 1 to {pageCount}, first page first.
              </span>
            ) : null}
          </div>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap gap-x-12 gap-y-7">
        <div className="flex flex-col gap-3">
          <span aria-hidden className={legend}>
            How many
          </span>
          <Segmented
            label="Number of questions"
            value={count}
            onChange={(c) => {
              setCount(c)
              setMinutes(null)
            }}
            options={COUNTS.map((c) => ({ value: c, label: c }))}
          />
        </div>
        <div className="flex flex-col gap-3">
          <span className={legend}>Feedback</span>
          <Segmented
            label="Feedback"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'instant', label: 'After each answer' },
              { value: 'exam', label: 'Exam: at the end' }
            ]}
          />
        </div>
        {mode === 'exam' ? (
          <label className="flex flex-col gap-3">
            <span className={legend}>Time limit</span>
            <span className="flex items-center gap-2 text-sm text-graphite">
              <input
                inputMode="numeric"
                value={minutesValue}
                onChange={(e) => setMinutes(e.target.value.replace(/\D/g, ''))}
                aria-invalid={!timeOk || undefined}
                className={cx(fieldClass, 'tabular h-8 w-16 text-center', !timeOk && 'border-redpen')}
              />
              minutes
            </span>
          </label>
        ) : null}
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className={cx(legend, 'mb-3')}>Question types</legend>
        <div className="flex flex-wrap gap-2">
          {TYPES.map(({ type, label }) => {
            const on = types.includes(type)
            return (
              <label
                key={type}
                title={typeHint[type]}
                className={cx(
                  'flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-semibold transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  on
                    ? 'border-accent bg-accent-soft text-ink'
                    : 'border-rule text-graphite hover:border-rule-strong'
                )}
              >
                <input
                  type="checkbox"
                  className="accent-[var(--color-accent)]"
                  checked={on}
                  onChange={() => setTypes(on ? types.filter((t) => t !== type) : [...types, type])}
                />
                {label}
              </label>
            )
          })}
        </div>
        {types.length === 0 ? (
          <p role="alert" className="text-sm text-redpen">
            Pick at least one type.
          </p>
        ) : null}
      </fieldset>

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" variant="primary" disabled={!valid} shortcut="Enter">
          {mode === 'exam' ? `Start the ${minutesValue}-minute exam` : `Start ${n} questions`}
        </Button>
        {create.isError ? (
          <p role="alert" className="text-sm text-redpen">
            {create.error.message}
          </p>
        ) : null}
      </div>
    </form>
  )
}
