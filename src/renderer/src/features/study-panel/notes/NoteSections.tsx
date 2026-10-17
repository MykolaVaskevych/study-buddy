import type { ReactNode } from 'react'
import type { Concept, ExamSignal, Exercise, Formula, PageKind } from '@shared/domain'
import { Badge, Markdown, Tex } from '../../../components'
import type { BadgeTone, IconName } from '../../../components'

export const signalBadge: Record<ExamSignal, { label: string; tone: BadgeTone; icon: IconName }> = {
  exam_trap: { label: 'Exam trap', tone: 'redpen', icon: 'alert' },
  practice_exam: { label: 'Practice exam', tone: 'accent', icon: 'flag' },
  quiz_slide: { label: 'Quiz slide', tone: 'accent', icon: 'target' },
  formula_sheet: { label: 'Formula sheet', tone: 'neutral', icon: 'notes' },
  worked_example: { label: 'Worked example', tone: 'ok', icon: 'check' },
  slide_correction: { label: 'Correction', tone: 'redpen', icon: 'alert' },
  emphasis: { label: 'Lecturer emphasis', tone: 'marker', icon: 'sparkle' }
}

export const kindLabel: Record<PageKind, string> = {
  title: 'Title page',
  toc: 'Contents',
  content: 'Content',
  exercise: 'Exercises',
  answers: 'Answers',
  references: 'References',
  blank: 'Blank page',
  other: 'Other'
}

export function Section({ title, children }: { title: string; children: ReactNode }): React.JSX.Element {
  return (
    <section className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-graphite">{title}</h3>
      {children}
    </section>
  )
}

type Cite = (page: number) => void

export function KeyPoints({ points, onCitation }: { points: string[]; onCitation: Cite }): React.JSX.Element {
  return (
    <ul className="prose-study flex flex-col gap-2">
      {points.map((p, i) => (
        <li key={i} className="flex gap-3">
          <span aria-hidden className="mt-[0.7em] size-1.5 shrink-0 rounded-full bg-ink/50" />
          <Markdown inline onCitation={onCitation}>
            {p}
          </Markdown>
        </li>
      ))}
    </ul>
  )
}

export function Concepts({
  concepts,
  onCitation
}: {
  concepts: Concept[]
  onCitation: Cite
}): React.JSX.Element {
  return (
    <dl className="flex flex-col gap-3">
      {concepts.map((c) => (
        <div key={c.term} className="flex flex-col gap-0.5">
          <dt className="flex items-center gap-2 font-serif font-semibold">
            <span className={c.importance === 'core' ? 'marker-stroke' : undefined}>{c.term}</span>
            {c.importance === 'core' ? <span className="sr-only">(core)</span> : null}
          </dt>
          <dd className="prose-study text-[0.95rem] text-graphite">
            <Markdown inline onCitation={onCitation}>
              {c.definition}
            </Markdown>
          </dd>
        </div>
      ))}
    </dl>
  )
}

export function FormulaBlock({ formula }: { formula: Formula }): React.JSX.Element {
  return (
    <figure className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4">
      <Tex latex={formula.latex} display className="text-[1.08rem] text-ink" />
      <figcaption className="flex items-start gap-2 text-sm text-graphite">
        {formula.importance === 'core' ? <Badge tone="marker">Core</Badge> : null}
        <span className="pt-0.5">{formula.meaning}</span>
      </figcaption>
      {formula.symbols.length > 0 ? (
        <table className="w-full border-collapse text-sm">
          <thead className="sr-only">
            <tr>
              <th>Symbol</th>
              <th>Meaning</th>
              <th>Unit</th>
            </tr>
          </thead>
          <tbody>
            {formula.symbols.map((s) => (
              <tr key={s.symbol} className="border-t border-rule align-baseline">
                <td className="w-24 py-1.5 pr-3 whitespace-nowrap">
                  <Tex latex={s.symbol} />
                </td>
                <td className="py-1.5 pr-3 text-ink">{s.meaning}</td>
                <td className="py-1.5 text-right whitespace-nowrap text-graphite">{s.unit ?? '–'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </figure>
  )
}

export function Exercises({
  exercises,
  onCitation
}: {
  exercises: Exercise[]
  onCitation: Cite
}): React.JSX.Element {
  return (
    <ol className="flex flex-col gap-3">
      {exercises.map((x, i) => (
        <li key={i} className="rounded-lg bg-sunken p-4">
          <Markdown onCitation={onCitation}>{x.question}</Markdown>
          {x.answer ? (
            <details className="group mt-3">
              <summary className="text-sm font-semibold text-accent select-none">Show answer</summary>
              <Markdown onCitation={onCitation} className="mt-2">
                {x.answer}
              </Markdown>
            </details>
          ) : null}
        </li>
      ))}
    </ol>
  )
}
