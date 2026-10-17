import { useState } from 'react'
import { Link } from 'react-router'
import { formatMinutes } from '@shared/planner'
import type { Schedule, StudyDay, StudySession } from '@shared/planner'
import { Button, cx, Icon } from '../../components'
import { formatDay } from './dates'
import { SESSION_KINDS, SESSION_ORDER, sessionTarget } from './sessions'

interface Props {
  schedule: Schedule
  docId: string
  today: string
  examDate: string | null
  pageOf: (topicId: string) => number | null
}

/** Long schedules start folded to the first week so the page stays scannable. */
const FOLD_AFTER = 10
const FOLDED_DAYS = 7

function SessionPill({
  session,
  docId,
  pageOf
}: {
  session: StudySession
  docId: string
  pageOf: Props['pageOf']
}): React.JSX.Element {
  const kind = SESSION_KINDS[session.kind]
  const body = (
    <>
      <span aria-hidden className={cx('w-1 self-stretch rounded-full', kind.bar)} />
      <span className="min-w-0 truncate">{session.label}</span>
      <span className="shrink-0 text-graphite tabular">{formatMinutes(session.minutes)}</span>
    </>
  )
  const pill = 'inline-flex max-w-full items-center gap-2 rounded-sm border py-1 pr-2 pl-1 text-sm'
  if (session.kind === 'learn') {
    return (
      <Link
        to={sessionTarget(session, docId, pageOf).to}
        className={cx(pill, 'border-rule bg-sheet text-ink hover:border-ink')}
      >
        {body}
      </Link>
    )
  }
  return <span className={cx(pill, 'border-transparent text-ink', kind.soft)}>{body}</span>
}

function DayRow({
  day,
  isToday,
  maxMinutes,
  docId,
  pageOf
}: {
  day: StudyDay
  isToday: boolean
  maxMinutes: number
  docId: string
  pageOf: Props['pageOf']
}): React.JSX.Element {
  return (
    <li
      aria-current={isToday ? 'date' : undefined}
      className={cx(
        'grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-4 rounded-md px-3 py-3',
        isToday ? 'bg-marker-soft/60' : 'border-t border-rule'
      )}
    >
      <div className="flex flex-col">
        <span className="font-semibold text-ink">
          {isToday ? <span className="marker-stroke">Today</span> : formatDay(day.date)}
        </span>
        <span className="text-xs text-graphite tabular">
          {isToday ? `${formatDay(day.date)}, ` : ''}
          {formatMinutes(day.totalMinutes)}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2">
        <div
          aria-hidden
          className="flex h-2 gap-px overflow-hidden rounded-full"
          style={{ width: `${Math.max(4, (day.totalMinutes / maxMinutes) * 100)}%` }}
        >
          {day.sessions.map((s, i) => (
            <span key={i} className={SESSION_KINDS[s.kind].bar} style={{ flexGrow: s.minutes }} />
          ))}
        </div>
        {day.sessions.length > 0 ? (
          <ul className="flex flex-wrap gap-1.5">
            {day.sessions.map((s, i) => (
              <li key={i} className="max-w-full">
                <SessionPill session={s} docId={docId} pageOf={pageOf} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-graphite">Rest day.</p>
        )}
      </div>
    </li>
  )
}

/** The plan as days until the exam: learn, check, spaced review and mock exams, today highlighted. */
export function ScheduleTimeline({ schedule, docId, today, examDate, pageOf }: Props): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const days = schedule.days
  const folded = !expanded && days.length > FOLD_AFTER
  const visible = folded ? days.slice(0, FOLDED_DAYS) : days
  const maxMinutes = Math.max(30, ...days.map((d) => d.totalMinutes))

  return (
    <section aria-labelledby="schedule-heading" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
        <div className="flex flex-col gap-0.5">
          <h2 id="schedule-heading" className="font-serif text-xl font-semibold">
            Day by day
          </h2>
          <p className="text-sm text-graphite">
            Open a learning session to read that topic from its first page.
          </p>
        </div>
        <ul aria-label="Session types" className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-graphite">
          {SESSION_ORDER.map((kind) => (
            <li key={kind} className="flex items-center gap-1.5">
              <span aria-hidden className={cx('size-2.5 rounded-xs', SESSION_KINDS[kind].bar)} />
              {SESSION_KINDS[kind].name}
            </li>
          ))}
        </ul>
      </div>

      {days.length === 0 ? (
        <p className="text-base text-graphite">No study days to schedule.</p>
      ) : (
        <ol aria-label="Study days" className="flex flex-col">
          {visible.map((day) => (
            <DayRow
              key={day.date}
              day={day}
              isToday={day.date === today}
              maxMinutes={maxMinutes}
              docId={docId}
              pageOf={pageOf}
            />
          ))}
        </ol>
      )}
      {folded ? (
        <Button
          variant="ghost"
          size="sm"
          icon="chevron-down"
          className="self-start"
          onClick={() => setExpanded(true)}
        >
          Show all {days.length} days
        </Button>
      ) : null}
      {examDate ? (
        <p className="flex items-center gap-2 border-t border-rule px-3 pt-3 font-semibold text-redpen">
          <Icon name="flag" size={16} />
          Exam on {formatDay(examDate)}
        </p>
      ) : null}
    </section>
  )
}
