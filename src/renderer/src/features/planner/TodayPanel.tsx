import { useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router'
import { formatMinutes } from '@shared/planner'
import type { StudyDay, StudySession } from '@shared/planner'
import type { DocumentSummary } from '@shared/domain'
import { useTodayPlans, useTopics } from '../../api/hooks'
import { useUiStore } from '../../app/uiStore'
import { Button, cx, Icon } from '../../components'
import { examCountdown } from '../library/format'
import { SESSION_KINDS, planPath, sessionTarget } from './sessions'

const countdownClass = {
  calm: 'text-graphite',
  soon: 'text-ink font-semibold',
  urgent: 'text-redpen font-semibold',
  past: 'text-faint'
} as const

function TodayBook({ doc, day, now }: { doc: DocumentSummary; day: StudyDay; now: Date }): React.JSX.Element {
  const topics = useTopics(doc.id)
  const navigate = useNavigate()
  const setStudyTab = useUiStore((s) => s.setStudyTab)
  const pages = useMemo(() => new Map((topics.data ?? []).map((t) => [t.id, t.pageStart])), [topics.data])
  const pageOf = useCallback((id: string) => pages.get(id) ?? null, [pages])
  const countdown = examCountdown(doc.examDate, now)

  const start = (session: StudySession): void => {
    const target = sessionTarget(session, doc.id, pageOf)
    if (target.studyTab) setStudyTab(target.studyTab)
    void navigate(target.to)
  }

  return (
    <article
      aria-label={doc.title}
      className="flex flex-col gap-3 rounded-lg border border-rule bg-sheet p-4"
    >
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="font-serif text-md font-semibold">
          <Link to={planPath(doc.id)} className="hover:text-accent hover:underline">
            {doc.title}
          </Link>
        </h3>
        {countdown ? (
          <span className={cx('flex items-center gap-1.5 text-sm', countdownClass[countdown.urgency])}>
            <Icon name="flag" size={14} />
            {countdown.text}
          </span>
        ) : null}
      </header>
      <p className="text-sm text-graphite tabular">{formatMinutes(day.totalMinutes)} planned today</p>
      <ul aria-label={`Today's sessions for ${doc.title}`} className="flex flex-col">
        {day.sessions.map((s, i) => (
          <li key={i} className="flex items-center gap-3 border-t border-rule py-2 first:border-t-0">
            <span aria-hidden className={cx('h-6 w-1 shrink-0 rounded-full', SESSION_KINDS[s.kind].bar)} />
            <span className="min-w-0 flex-1 text-sm text-ink">{s.label}</span>
            <span className="shrink-0 text-sm text-graphite tabular">{formatMinutes(s.minutes)}</span>
            <Button size="sm" aria-label={`Start: ${s.label}`} onClick={() => start(s)}>
              Start
            </Button>
          </li>
        ))}
      </ul>
    </article>
  )
}

/**
 * "Today" for every book with a saved plan: today's sessions with a Start button each and the exam
 * countdown. Renders nothing when no book has sessions today.
 */
export function TodayPanel({ docs, now }: { docs: DocumentSummary[]; now: Date }): React.JSX.Element | null {
  const days = useTodayPlans(docs.map((d) => d.id))
  const entries = docs.flatMap((doc, i) => {
    const day = days[i]?.data
    return day && day.sessions.length > 0 ? [{ doc, day }] : []
  })
  if (entries.length === 0) return null
  return (
    <section aria-labelledby="today-heading" className="flex flex-col gap-3">
      <h2 id="today-heading" className="font-serif text-xl font-semibold">
        <span className="marker-stroke">Today</span>
      </h2>
      <div className="grid gap-4 lg:grid-cols-2">
        {entries.map(({ doc, day }) => (
          <TodayBook key={doc.id} doc={doc} day={day} now={now} />
        ))}
      </div>
    </section>
  )
}
