import { memo, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router'
import { approxPercent, formatMinutes, formatPercent } from '@shared/planner'
import type { StudyLevel } from '@shared/planner'
import { cx, Icon, IconButton, Tooltip } from '../../components'
import { bookPath } from './sessions'
import type { RowGroup, TriageRow } from './triage'

/**
 * The triage table: one row per topic with the level the planner chose (a control that also pins
 * it), time, expected marks, exam weight (editable), difficulty and the planner's reason.
 */

export const LEVEL_NAMES: Record<StudyLevel, string> = { full: 'Full', core: 'Core', skip: 'Skip' }

/**
 * Levels in the pencil-case language: full study is inked, core is highlighted (just the
 * essentials), a skip is a dashed pencil outline.
 */
const chipClass: Record<StudyLevel, string> = {
  full: 'bg-primary text-on-primary',
  core: 'bg-marker text-marker-ink',
  skip: 'border border-dashed border-rule-strong text-graphite'
}

export interface RowActions {
  onPin: (topicId: string, level: StudyLevel | null) => void
  onWeight: (topicId: string, weight: number | null) => void
  /** Called by a level control as it mounts; true means "take focus" (it moved after a pin). */
  claimFocus: (topicId: string) => boolean
}

function LevelPicker({ row, actions }: { row: TriageRow; actions: RowActions }): React.JSX.Element {
  const select = useRef<HTMLSelectElement>(null)
  const { item, pin, title, id } = row
  useEffect(() => {
    if (actions.claimFocus(id)) select.current?.focus()
  }, [actions, id])

  const forcedLabel =
    item.forcedBy === 'prerequisite' && row.requiredBy.length > 0
      ? `Studied because ${row.requiredBy.map((t) => `'${t}'`).join(', ')} ${row.requiredBy.length === 1 ? 'builds' : 'build'} on it`
      : null
  return (
    <div className="flex items-center gap-1.5">
      <span
        className={cx(
          'relative inline-flex h-7 w-[5.25rem] items-center justify-between gap-1 rounded-sm pr-1.5 pl-2 text-xs font-semibold',
          'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
          chipClass[item.level]
        )}
      >
        <span className="flex items-center gap-1">
          {pin !== null ? <Icon name="pin" size={12} /> : null}
          {LEVEL_NAMES[item.level]}
        </span>
        <Icon name="chevron-down" size={12} className="opacity-70" />
        <select
          ref={select}
          aria-label={`Level for ${title}`}
          value={pin ?? 'auto'}
          onChange={(e) => {
            const v = e.target.value
            actions.onPin(id, v === 'full' || v === 'core' || v === 'skip' ? v : null)
          }}
          className="absolute inset-0 cursor-pointer appearance-none opacity-0"
        >
          <option value="auto">
            {pin === null ? `Auto: ${LEVEL_NAMES[item.level]}` : 'Auto: let the planner decide'}
          </option>
          <option value="full">Full (pinned)</option>
          <option value="core">Core only (pinned)</option>
          <option value="skip">Skip (pinned)</option>
        </select>
      </span>
      {forcedLabel ? (
        <Tooltip label={forcedLabel} side="top">
          <span
            role="img"
            tabIndex={0}
            aria-label={forcedLabel}
            className="inline-flex size-6 items-center justify-center rounded-sm text-graphite hover:text-ink"
          >
            <Icon name="link" size={15} />
          </span>
        </Tooltip>
      ) : null}
    </div>
  )
}

/** Exam weight in percent; editing it overrides the AI estimate for this plan. */
function WeightField({ row, actions }: { row: TriageRow; actions: RowActions }): React.JSX.Element {
  const shown = Math.round(row.weight * 100)
  // While typing, the field may hold text that isn't a valid weight yet (e.g. empty).
  const [text, setText] = useState<string | null>(null)
  return (
    <div className="flex items-center gap-0.5">
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={100}
        step={1}
        aria-label={`Exam weight of ${row.title}, percent`}
        value={text ?? String(shown)}
        onChange={(e) => {
          setText(e.target.value)
          const v = Number(e.target.value)
          if (e.target.value.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 100) {
            actions.onWeight(row.id, v / 100)
          }
        }}
        onBlur={() => setText(null)}
        className={cx(
          'h-7 w-11 rounded-sm border bg-sheet px-1 text-right text-sm tabular [appearance:textfield] focus-visible:border-accent [&::-webkit-inner-spin-button]:appearance-none',
          // An edited weight is inked, like a pinned level; an estimate stays a light field.
          row.weightOverridden ? 'border-ink font-semibold' : 'border-rule hover:border-rule-strong'
        )}
      />
      <span aria-hidden className="text-sm text-graphite">
        %
      </span>
      {row.weightOverridden ? (
        <IconButton
          icon="review"
          size="sm"
          tooltipSide="top"
          label={`Use the estimate (${formatPercent(row.estimatedWeight)})`}
          onClick={() => {
            setText(null)
            actions.onWeight(row.id, null)
          }}
        />
      ) : null}
    </div>
  )
}

function Difficulty({ value }: { value: number | null }): React.JSX.Element {
  if (value === null) return <span className="text-faint">–</span>
  const level = Math.round(Math.min(5, Math.max(1, value)))
  return (
    <span role="img" aria-label={`Difficulty ${level} of 5`} className="inline-flex items-end gap-[3px]">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={cx('w-[5px] rounded-[1px]', i <= level ? 'bg-ink' : 'bg-rule')}
          style={{ height: 4 + i * 2 }}
        />
      ))}
    </span>
  )
}

const pagesLabel = (row: TriageRow): string | null =>
  row.pageStart === null
    ? null
    : row.pageEnd === null || row.pageEnd === row.pageStart
      ? `p. ${row.pageStart}`
      : `pp. ${row.pageStart}–${row.pageEnd}`

interface RowProps {
  row: TriageRow
  docId: string
  actions: RowActions
  /** Animation class when the level just changed, else null. */
  flash: string | null
}

const TopicRow = memo(function TopicRow({ row, docId, actions, flash }: RowProps): React.JSX.Element {
  const pages = pagesLabel(row)
  const skipped = row.item.level === 'skip'
  return (
    <tr data-topic={row.id} className={cx('border-t border-rule align-top', flash)}>
      <td className="py-3 pr-4 pl-2">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <Link
            to={bookPath(docId, row.pageStart)}
            className={cx(
              'font-semibold hover:text-accent hover:underline',
              skipped ? 'text-graphite' : 'text-ink'
            )}
          >
            {row.title}
          </Link>
          {pages ? <span className="text-xs text-faint tabular">{pages}</span> : null}
        </div>
        <p className="mt-0.5 text-sm text-graphite">{row.item.reason}</p>
      </td>
      <td className="py-3 pr-2">
        <LevelPicker row={row} actions={actions} />
      </td>
      <td className="py-3 pt-4 pr-2 text-sm tabular">
        {skipped ? <span className="text-faint">–</span> : formatMinutes(row.item.minutes)}
      </td>
      <td className="py-3 pt-4 pr-2 text-sm tabular">{approxPercent(row.item.expectedMarks)}</td>
      <td className="py-3 pr-2">
        <WeightField row={row} actions={actions} />
      </td>
      <td className="py-3 pt-4 pr-2">
        <Difficulty value={row.difficulty} />
      </td>
    </tr>
  )
})

interface TableProps {
  caption: string
  groups: RowGroup[]
  docId: string
  actions: RowActions
  /** Topic ids whose level just changed, with the animation class to use. */
  changed: ReadonlySet<string>
  flashClass: string
}

/** One table of topics. Study and skipped tables share column widths so they line up. */
export function TriageTable({
  caption,
  groups,
  docId,
  actions,
  changed,
  flashClass
}: TableProps): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[46rem] table-fixed border-collapse text-left">
        <caption className="sr-only">{caption}</caption>
        <colgroup>
          <col />
          <col className="w-[8.5rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[5.5rem]" />
          <col className="w-[7rem]" />
          <col className="w-[5.5rem]" />
        </colgroup>
        <thead>
          <tr className="text-xs text-graphite">
            <th scope="col" className="pb-2 pl-2 font-semibold">
              Topic and why
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Level
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Time
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Expected marks
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Exam weight
            </th>
            <th scope="col" className="pb-2 font-semibold">
              Difficulty
            </th>
          </tr>
        </thead>
        {groups.map((group) => (
          <tbody key={group.key}>
            {group.chapter ? (
              <tr>
                <th
                  scope="colgroup"
                  colSpan={6}
                  className="pt-5 pb-1.5 pl-2 font-serif text-base font-semibold text-ink"
                >
                  {group.chapter.title}
                </th>
              </tr>
            ) : null}
            {group.rows.map((row) => (
              <TopicRow
                key={row.id}
                row={row}
                docId={docId}
                actions={actions}
                flash={changed.has(row.id) ? flashClass : null}
              />
            ))}
          </tbody>
        ))}
      </table>
    </div>
  )
}
