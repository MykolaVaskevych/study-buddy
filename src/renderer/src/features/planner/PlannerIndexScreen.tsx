import { useState } from 'react'
import { Link } from 'react-router'
import { formatMinutes, formatPercent } from '@shared/planner'
import type { ExamPlan } from '@shared/planner'
import type { DocumentSummary } from '@shared/domain'
import { useLibrary, usePlan } from '../../api/hooks'
import { buttonClass, cx, EmptyState, Icon, Skeleton } from '../../components'
import { examCountdown } from '../library/format'
import { planPath } from './sessions'
import { TodayPanel } from './TodayPanel'

function planSummary(doc: DocumentSummary, plan: ExamPlan | null): string {
  if (plan) {
    const r = plan.result
    return `Expected ${formatPercent(r.expectedScore)} for a ${formatPercent(r.targetScore)} target, ${formatMinutes(r.plannedMinutes)} of learning.`
  }
  if (doc.index.state !== 'done' && doc.index.indexedPages === 0)
    return 'Not indexed yet: the planner needs the topics first.'
  return 'No plan yet.'
}

function PlanRow({ doc, now }: { doc: DocumentSummary; now: Date }): React.JSX.Element {
  const plan = usePlan(doc.id)
  const countdown = examCountdown(doc.examDate, now)
  return (
    <li className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-rule py-4">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <h3 className="font-serif text-lg font-semibold text-ink">{doc.title}</h3>
        <div className="text-sm text-graphite">
          {plan.isPending ? <Skeleton className="h-3.5 w-64" /> : planSummary(doc, plan.data ?? null)}
        </div>
      </div>
      {countdown ? (
        <span
          className={cx(
            'flex items-center gap-1.5 text-sm',
            countdown.urgency === 'urgent' ? 'font-semibold text-redpen' : 'text-graphite'
          )}
        >
          <Icon name="flag" size={14} />
          {countdown.text}
        </span>
      ) : null}
      <Link
        to={planPath(doc.id)}
        aria-label={`${plan.data ? 'Open the plan' : 'Make a plan'} for ${doc.title}`}
        className={buttonClass(plan.data ? 'secondary' : 'primary', 'sm')}
      >
        {plan.data ? 'Open plan' : 'Make a plan'}
      </Link>
    </li>
  )
}

/** Route /planner: today's sessions across books, and every book with its plan status. */
export function PlannerIndexScreen(): React.JSX.Element {
  const library = useLibrary()
  const [now] = useState(() => new Date())
  const docs = library.data ?? []

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-9 px-10 py-9">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-semibold">Planner</h1>
          <p className="max-w-[62ch] text-base text-graphite">
            Tell the planner your exam date and the hours you have. It picks what to study in full, what to
            cover only in essentials, and what to skip, and says why.
          </p>
        </header>

        {library.isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : docs.length === 0 ? (
          <EmptyState
            icon="planner"
            title="No books to plan yet"
            actions={
              <Link to="/" className={buttonClass('primary')}>
                Go to the library
              </Link>
            }
          >
            <p>Import the PDFs your exam is built on; each book gets its own plan.</p>
          </EmptyState>
        ) : (
          <>
            <TodayPanel docs={docs} now={now} />
            <section aria-labelledby="plans-heading" className="flex flex-col">
              <h2 id="plans-heading" className="mb-1 text-sm font-semibold text-graphite">
                Your books
              </h2>
              <ul>
                {docs.map((doc) => (
                  <PlanRow key={doc.id} doc={doc} now={now} />
                ))}
              </ul>
            </section>
          </>
        )}
      </div>
    </div>
  )
}
