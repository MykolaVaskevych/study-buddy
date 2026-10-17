import { useMemo } from 'react'
import { PLANNER_DEFAULTS, formatMinutes, formatPercent } from '@shared/planner'
import type { PlanTopic } from '@shared/planner'
import { Button, cx, Icon } from '../../components'
import { LIMITS, studyDays } from './draft'
import type { PlannerDraft } from './draft'
import { bestReachable, groupNotes, hoursPerDayFor, neededMinutes, targetOutOfReach } from './preview'
import type { Preview } from './preview'

interface Props {
  preview: Preview
  topics: PlanTopic[]
  draft: PlannerDraft
  today: string
  onChange: (next: PlannerDraft) => void
}

const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))
/** Whole percent at or below `x`, so "aim for" targets are always reachable. */
const floorPercent = (x: number): number => Math.floor(x * 100 + 1e-9) / 100

/** "72 %" split so the number can be set large and the unit small. */
function percentParts(share: number): [string, string] {
  const [num = '0', unit = '%'] = formatPercent(share).split(' ')
  return [num, unit]
}

/**
 * The expected score on a ruler, like a mark on an exam script: ink (green once it reaches the
 * target) up to the expected score, and the target as a red-pen tick. Decorative: the number and
 * the status sentence above it carry the same information for screen readers.
 */
function ScoreRuler({
  expected,
  target,
  reached
}: {
  expected: number
  target: number
  reached: boolean
}): React.JSX.Element {
  const e = clamp01(expected) * 100
  const t = clamp01(target) * 100
  const labelShift = t > 88 ? '-translate-x-full' : t < 12 ? 'translate-x-0' : '-translate-x-1/2'
  return (
    <div aria-hidden className="relative h-[4.25rem] select-none">
      <span
        className={cx(
          'absolute top-0 text-xs font-semibold whitespace-nowrap text-redpen tabular',
          labelShift
        )}
        style={{ left: `${t}%` }}
      >
        Target {formatPercent(target)}
      </span>
      <div className="absolute inset-x-0 top-6 h-3.5 overflow-hidden rounded-xs bg-sunken">
        <div
          className={cx(
            'h-full transition-[width,background-color] duration-300 ease-out',
            reached ? 'bg-ok' : 'bg-ink'
          )}
          style={{ width: `${e}%` }}
        />
      </div>
      <span
        className="absolute top-[1.125rem] h-[1.625rem] w-[3px] -translate-x-1/2 rounded-full bg-redpen"
        style={{ left: `${t}%` }}
      />
      {Array.from({ length: 11 }, (_, i) => (
        <span
          key={i}
          className={cx(
            'absolute top-[2.75rem] w-px -translate-x-1/2 bg-rule-strong',
            i % 5 === 0 ? 'h-2' : 'h-1'
          )}
          style={{ left: `${i * 10}%` }}
        />
      ))}
      {[0, 50, 100].map((p) => (
        <span
          key={p}
          className={cx(
            'absolute top-[3.25rem] text-2xs whitespace-nowrap text-faint tabular',
            p === 0 ? 'translate-x-0' : p === 100 ? '-translate-x-full' : '-translate-x-1/2'
          )}
          style={{ left: `${p}%` }}
        >
          {formatPercent(p / 100)}
        </span>
      ))}
    </div>
  )
}

interface Fix {
  label: string
  apply: () => void
  primary?: boolean
}

/** Expected score against the target, what to change when it falls short, and where the time goes. */
export function ScoreHeadline({ preview, topics, draft, today, onChange }: Props): React.JSX.Element {
  const { result, input } = preview
  const notes = groupNotes(result.notes)
  const reached = result.expectedScore + 1e-6 >= result.targetScore
  const needed = reached ? null : neededMinutes(result.notes)
  const outOfReach = !reached && targetOutOfReach(result.notes)
  const best = useMemo(() => (outOfReach ? bestReachable(topics, input) : null), [outOfReach, topics, input])
  const days = studyDays(draft.examDate, today)
  const [num, unit] = percentParts(result.expectedScore)
  const target = formatPercent(result.targetScore)

  const status = result.feasible
    ? `Reaches your ${target} target`
    : reached
      ? 'Your pinned topics need more time than you have'
      : `Below your ${target} target`

  const fixes: Fix[] = []
  if (needed !== null) {
    fixes.push({
      label: `Use ${formatMinutes(needed)}`,
      primary: true,
      apply: () => onChange({ ...draft, budgetMode: 'total', totalHours: needed / 60 })
    })
    const perDay = days !== null ? hoursPerDayFor(needed, days) : null
    if (perDay !== null && perDay <= LIMITS.hoursPerDay.max && draft.examDate !== null) {
      fixes.push({
        label: `Study ${formatMinutes(perDay * 60)} a day`,
        apply: () => onChange({ ...draft, budgetMode: 'daily', hoursPerDay: perDay })
      })
    }
  }
  const aim = floorPercent(needed !== null ? result.expectedScore : (best ?? 0))
  if ((needed !== null || outOfReach) && aim >= LIMITS.target.min && aim < result.targetScore) {
    fixes.push({
      label: `Aim for ${formatPercent(aim)}`,
      primary: fixes.length === 0,
      apply: () => onChange({ ...draft, targetScore: aim })
    })
  }

  return (
    <section data-tour="plan-score" aria-labelledby="plan-score" className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-2">
        <div className="flex flex-col">
          <h2 id="plan-score" className="text-sm font-semibold text-graphite">
            Expected score
          </h2>
          <p className="font-serif text-[4.75rem] leading-[0.95] font-semibold tracking-tight text-ink tabular">
            {num}
            <span className="ml-1 text-[0.42em] font-medium text-graphite">{unit}</span>
          </p>
        </div>
        <p
          aria-live="polite"
          aria-atomic="true"
          className={cx(
            'flex items-center gap-1.5 pb-2.5 text-md font-semibold',
            result.feasible ? 'text-ok' : 'text-redpen'
          )}
        >
          <Icon name={result.feasible ? 'check' : 'flag'} size={18} />
          <span>
            {status}
            <span className="sr-only">: expected {formatPercent(result.expectedScore)}</span>
          </span>
        </p>
      </div>

      <ScoreRuler expected={result.expectedScore} target={result.targetScore} reached={reached} />

      {!reached && notes.outcome ? (
        <div
          role="group"
          aria-label="How to reach your target"
          className="flex flex-col gap-3 rounded-lg bg-marker-soft px-4 py-3.5"
        >
          <p className="flex items-start gap-2 text-base text-ink">
            <Icon name="alert" size={18} className="mt-0.5 shrink-0" />
            <span>{notes.outcome}</span>
          </p>
          {fixes.length > 0 ? (
            <div className="flex flex-wrap gap-2 pl-[26px]">
              {fixes.map((fix) => (
                <Button
                  key={fix.label}
                  size="sm"
                  variant={fix.primary ? 'primary' : 'secondary'}
                  onClick={fix.apply}
                >
                  {fix.label}
                </Button>
              ))}
            </div>
          ) : null}
        </div>
      ) : notes.outcome && !notes.outcome.startsWith('Expected ') ? (
        // "Expected ~84 %, at or above your target" repeats the status line; the min-time note
        // ("reached with 9 h of learning; 5 h to spare") adds something, so only that one shows.
        <p className="text-base text-graphite">{notes.outcome}</p>
      ) : null}

      {notes.other.length > 0 ? (
        <ul aria-label="Planner notes" className="flex flex-col gap-1.5">
          {notes.other.map((note) => (
            <li key={note} className="flex items-start gap-2 text-sm text-ink">
              <Icon name="alert" size={16} className="mt-0.5 shrink-0 text-redpen" />
              {note}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="flex flex-col gap-2 border-t border-rule pt-4">
        <dl className="grid grid-cols-3 gap-4">
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-graphite">Learning planned</dt>
            <dd className="text-lg font-semibold tabular">{formatMinutes(result.plannedMinutes)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-graphite">Learning time</dt>
            <dd className="text-lg font-semibold tabular">{formatMinutes(result.budgetMinutes)}</dd>
          </div>
          <div className="flex flex-col gap-0.5">
            <dt className="text-xs text-graphite">Kept for checks, review and mocks</dt>
            <dd className="text-lg font-semibold tabular">{formatMinutes(result.reserveMinutes)}</dd>
          </div>
        </dl>
        {notes.budget
          .filter((n) => n.startsWith('Budget:'))
          .map((n) => (
            <p key={n} className="text-sm text-graphite">
              {n}
            </p>
          ))}
        <details className="text-sm text-graphite">
          <summary className="w-fit cursor-pointer font-semibold hover:text-ink">
            How the score is estimated
          </summary>
          <p className="mt-2 max-w-[68ch]">
            Each topic counts with its exam weight. Studying only the essentials gets about{' '}
            {formatPercent(PLANNER_DEFAULTS.pCore)} of those questions right, studying in full about{' '}
            {formatPercent(PLANNER_DEFAULTS.pFull)}, and a skipped topic only what guessing gives. Your quiz
            results raise these numbers where you already do better. It is an estimate to plan with, not a
            promise.
          </p>
        </details>
      </div>
    </section>
  )
}
