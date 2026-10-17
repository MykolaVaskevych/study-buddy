import { useId } from 'react'
import { PLANNER_DEFAULTS, formatMinutes, formatPercent } from '@shared/planner'
import type { ExamFormat, PlanMode } from '@shared/planner'
import { Icon } from '../../components'
import { RadioCards, Segmented, Slider } from './controls'
import type { Choice } from './controls'
import { daysBetween } from './dates'
import { LIMITS, studyDays, withBudgetMode } from './draft'
import type { BudgetMode, PlannerDraft } from './draft'

interface Props {
  draft: PlannerDraft
  today: string
  onChange: (next: PlannerDraft) => void
}

const budgetModes: readonly Choice<BudgetMode>[] = [
  { value: 'daily', label: 'Per day' },
  { value: 'total', label: 'In total' }
]

const planModes: readonly Choice<PlanMode>[] = [
  {
    value: 'max_score',
    label: 'Best score in my time',
    description: 'Uses all the time you have for the highest expected score.'
  },
  {
    value: 'min_time',
    label: 'Least time for my target',
    description: 'Reaches your target with as little study as possible.'
  }
]

const formats: readonly Choice<ExamFormat>[] = [
  { value: 'mcq', label: 'MCQ' },
  { value: 'written', label: 'Written' },
  { value: 'numeric', label: 'Numeric' },
  { value: 'mixed', label: 'Mixed' }
]

/** What the format changes, in the planner's own numbers: marks a skipped topic still earns. */
function formatHint(format: ExamFormat): string {
  const guess = PLANNER_DEFAULTS.guess[format]
  if (format === 'mcq') return `Skipped topics still earn about ${formatPercent(guess)} by guessing.`
  if (guess > 0)
    return `Skipped topics still earn about ${formatPercent(guess)} from guesses and partial credit.`
  return 'Skipped topics earn nothing, so skipping costs more.'
}

function examDateHint(examDate: string | null, today: string): string {
  if (!examDate) return 'No date yet. Hours per day need one; total hours work without.'
  const d = daysBetween(today, examDate)
  if (d === null) return 'That is not a valid date.'
  if (d < 0) return 'That date has passed.'
  if (d === 0) return 'Today. The plan fits everything into today.'
  return d === 1 ? 'Tomorrow: one study day left.' : `In ${d} days.`
}

/** The left column: everything the plan depends on. Every change re-solves the preview. */
export function PlanForm({ draft, today, onChange }: Props): React.JSX.Element {
  const dateId = useId()
  const days = studyDays(draft.examDate, today)
  const totalMax = Math.max(LIMITS.totalHours.max, Math.ceil(draft.totalHours / 10) * 10)
  const set = (patch: Partial<PlannerDraft>): void => onChange({ ...draft, ...patch })

  return (
    <form
      aria-label="Plan settings"
      className="grid content-start items-start gap-6 md:grid-cols-2 md:gap-x-10 lg:grid-cols-1"
      onSubmit={(e) => e.preventDefault()}
    >
      <h2 className="font-serif text-lg font-semibold md:col-span-2 lg:col-span-1">Your exam</h2>

      <div className="flex flex-col gap-1">
        <label htmlFor={dateId} className="text-sm font-semibold text-ink">
          Exam date
        </label>
        <input
          id={dateId}
          type="date"
          min={today}
          value={draft.examDate ?? ''}
          aria-describedby={`${dateId}-hint`}
          onChange={(e) => set({ examDate: e.target.value || null })}
          className="h-9 rounded-md border border-rule-strong bg-sheet px-2.5 text-base text-ink tabular focus-visible:border-accent"
        />
        <p id={`${dateId}-hint`} className="text-xs text-graphite">
          {examDateHint(draft.examDate, today)}
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <Segmented
          legend="Study time"
          value={draft.budgetMode}
          options={budgetModes}
          onChange={(mode) => onChange(withBudgetMode(draft, mode, today))}
        />
        {draft.budgetMode === 'daily' ? (
          <Slider
            label="Hours per day"
            value={draft.hoursPerDay}
            min={LIMITS.hoursPerDay.min}
            max={LIMITS.hoursPerDay.max}
            step={LIMITS.hoursPerDay.step}
            valueText={`${formatMinutes(draft.hoursPerDay * 60)} a day`}
            onChange={(hoursPerDay) => set({ hoursPerDay })}
            hint={
              days !== null
                ? `${formatMinutes(draft.hoursPerDay * 60 * days)} over ${days} ${days === 1 ? 'day' : 'days'}.`
                : 'Set an exam date to count the days.'
            }
          />
        ) : (
          <Slider
            label="Total hours"
            value={draft.totalHours}
            min={LIMITS.totalHours.min}
            max={totalMax}
            step={LIMITS.totalHours.step}
            valueText={formatMinutes(draft.totalHours * 60)}
            onChange={(totalHours) => set({ totalHours })}
            hint={
              days !== null
                ? `About ${formatMinutes((draft.totalHours * 60) / days)} a day over ${days} ${days === 1 ? 'day' : 'days'}.`
                : undefined
            }
          />
        )}
      </div>

      <Slider
        label="Target score"
        value={Math.round(draft.targetScore * 100)}
        min={LIMITS.target.min * 100}
        max={LIMITS.target.max * 100}
        step={1}
        valueText={formatPercent(draft.targetScore)}
        onChange={(pct) => set({ targetScore: pct / 100 })}
      />

      <RadioCards
        legend="Plan for"
        value={draft.mode}
        options={planModes}
        onChange={(mode) => set({ mode })}
      />

      <div className="flex flex-col gap-1.5">
        <Segmented
          legend="Exam format"
          value={draft.format}
          options={formats}
          onChange={(format) => set({ format })}
        />
        <p className="text-xs text-graphite">{formatHint(draft.format)}</p>
      </div>

      <details className="group rounded-md border border-rule px-3 py-2 open:pb-4">
        <summary className="flex items-center gap-1.5 text-sm font-semibold text-graphite marker:content-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <Icon name="chevron-right" size={14} className="transition-transform group-open:rotate-90" />
          Advanced
        </summary>
        <div className="mt-3">
          <Slider
            label="Kept for review and mocks"
            value={draft.reserveFraction}
            min={LIMITS.reserve.min}
            max={LIMITS.reserve.max}
            step={LIMITS.reserve.step}
            valueText={formatPercent(draft.reserveFraction)}
            onChange={(reserveFraction) => set({ reserveFraction })}
            hint="Share of your time held back for page checks, spaced review and mock exams."
          />
        </div>
      </details>
    </form>
  )
}
