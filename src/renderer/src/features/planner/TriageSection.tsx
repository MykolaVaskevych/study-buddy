import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { approxPercent, formatMinutes } from '@shared/planner'
import type { StudyLevel } from '@shared/planner'
import { Button } from '../../components'
import { Segmented } from './controls'
import type { Choice } from './controls'
import { changedLevels, groupRows, hasChapters, skipSummary, sortRows } from './triage'
import type { SortKey, TriageRow } from './triage'
import { TriageTable } from './TriageTable'
import type { RowActions } from './TriageTable'

interface Props {
  rows: TriageRow[]
  docId: string
  plannedMinutes: number
  /** Fingerprint of the levels (see triage.levelKey); a change highlights the rows that moved. */
  levels: string
  changedTopics: number
  onPin: (topicId: string, level: StudyLevel | null) => void
  onWeight: (topicId: string, weight: number | null) => void
  onResetTopics: () => void
}

const sorts: readonly Choice<SortKey>[] = [
  { value: 'value', label: 'Value for time' },
  { value: 'weight', label: 'Exam weight' },
  { value: 'time', label: 'Time' },
  { value: 'page', label: 'Page order' }
]

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

/** "What to study": the topics the plan covers, then the skipped ones with what they cost. */
export function TriageSection({
  rows,
  docId,
  plannedMinutes,
  levels,
  changedTopics,
  onPin,
  onWeight,
  onResetTopics
}: Props): React.JSX.Element {
  const groupId = useId()
  const [sort, setSort] = useState<SortKey>('value')
  const [byChapter, setByChapter] = useState(true)
  const chapters = hasChapters(rows)
  const studyRows = useMemo(() => rows.filter((r) => r.item.level !== 'skip'), [rows])
  const study = useMemo(
    () => groupRows(sortRows(studyRows, sort), chapters && byChapter),
    [studyRows, sort, chapters, byChapter]
  )
  const skipped = useMemo(
    () =>
      sortRows(
        rows.filter((r) => r.item.level === 'skip'),
        sort
      ),
    [rows, sort]
  )
  const summary = skipSummary(rows)

  // Remember the previous levels so rows that just changed can be highlighted.
  const [seen, setSeen] = useState({ levels, changed: new Set<string>(), generation: 0 })
  if (seen.levels !== levels) {
    setSeen({ levels, changed: changedLevels(seen.levels, levels), generation: seen.generation + 1 })
  }
  const flashClass = seen.generation % 2 === 0 ? 'sb-changed-a' : 'sb-changed-b'

  // Pinning a row to or from "skip" moves it to the other table. Its level control asks for the
  // focus as it mounts there, so keyboard users keep their place.
  const pendingFocus = useRef<string | null>(null)
  useEffect(() => {
    pendingFocus.current = null
  }, [levels])
  const actions = useMemo<RowActions>(
    () => ({
      onPin: (topicId, level) => {
        pendingFocus.current = topicId
        onPin(topicId, level)
      },
      onWeight,
      claimFocus: (topicId) => {
        if (pendingFocus.current !== topicId) return false
        pendingFocus.current = null
        return true
      }
    }),
    [onPin, onWeight]
  )

  return (
    <section aria-labelledby="triage-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-0.5">
          <h2 id="triage-heading" className="font-serif text-xl font-semibold">
            What to study
          </h2>
          <p className="text-sm text-graphite">
            {plural(studyRows.length, 'topic', 'topics')}, {formatMinutes(plannedMinutes)} of learning. Pin a
            level or change a weight and the plan follows.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span aria-hidden className="text-sm text-graphite">
              Sort by
            </span>
            <Segmented legend="Sort topics by" hideLegend value={sort} options={sorts} onChange={setSort} />
          </div>
          {chapters ? (
            <label htmlFor={groupId} className="flex items-center gap-2 text-sm text-ink">
              <input
                id={groupId}
                type="checkbox"
                checked={byChapter}
                onChange={(e) => setByChapter(e.target.checked)}
                className="size-3.5 accent-ink"
              />
              Group by chapter
            </label>
          ) : null}
          {changedTopics > 0 ? (
            <Button size="sm" variant="ghost" icon="review" onClick={onResetTopics}>
              Undo {plural(changedTopics, 'topic change', 'topic changes')}
            </Button>
          ) : null}
        </div>
      </div>

      {study.length > 0 ? (
        <TriageTable
          caption="Topics in the plan"
          groups={study}
          docId={docId}
          actions={actions}
          changed={seen.changed}
          flashClass={flashClass}
        />
      ) : (
        <p className="rounded-lg bg-sunken px-4 py-3 text-base text-graphite">
          Nothing to study in this plan yet. Add time, or pin a topic to Core or Full.
        </p>
      )}

      {skipped.length > 0 ? (
        <section
          aria-labelledby="skipped-heading"
          className="mt-3 flex flex-col gap-3 rounded-lg border border-dashed border-rule-strong px-3 pt-3 pb-1"
        >
          <div className="flex flex-col gap-0.5 px-2">
            <h3 id="skipped-heading" className="font-serif text-lg font-semibold">
              Skipped
            </h3>
            <p className="text-sm text-ink">
              You are leaving out {plural(summary.count, 'topic', 'topics')}. Studying{' '}
              {summary.count === 1 ? 'it' : 'them'} in full would take {formatMinutes(summary.minutes)} more
              and add {approxPercent(summary.gain)} to your expected score.
            </p>
          </div>
          <TriageTable
            caption="Skipped topics"
            groups={[{ key: 'skipped', chapter: null, rows: skipped }]}
            docId={docId}
            actions={actions}
            changed={seen.changed}
            flashClass={flashClass}
          />
        </section>
      ) : (
        <p className="text-sm text-graphite">Nothing is skipped: every topic is in the plan.</p>
      )}
    </section>
  )
}
