import { Link } from 'react-router'
import type { DocumentSummary } from '@shared/domain'
import { Badge, cx, Icon, Progress } from '../../components'
import { examCountdown, relativeDay, spineIndex } from './format'
import type { Urgency } from './format'

const urgencyClass: Record<Urgency, string> = {
  calm: 'text-graphite',
  soon: 'text-ink font-semibold',
  urgent: 'text-redpen font-semibold',
  past: 'text-faint'
}

const spineClass = ['bg-spine-1', 'bg-spine-2', 'bg-spine-3', 'bg-spine-4', 'bg-spine-5', 'bg-spine-6']

function IndexLine({ doc }: { doc: DocumentSummary }): React.JSX.Element {
  const { index } = doc
  if (index.state === 'done') {
    return (
      <p className="flex items-center gap-1.5 text-sm text-ok">
        <Icon name="check" size={14} /> Notes ready for all {doc.pageCount} pages
      </p>
    )
  }
  const value = index.totalPages > 0 ? index.indexedPages / index.totalPages : 0
  const text =
    index.state === 'none'
      ? 'Not indexed yet'
      : index.state === 'paused'
        ? `Indexing paused at ${index.indexedPages} of ${index.totalPages}`
        : index.state === 'error'
          ? 'Indexing stopped with an error'
          : `Indexing, ${index.indexedPages} of ${index.totalPages} pages`
  return (
    <div className="flex flex-col gap-1.5">
      <p className={cx('text-sm', index.state === 'error' ? 'text-redpen' : 'text-graphite')}>{text}</p>
      <Progress value={value} label="Pages indexed" valueText={text} tone="accent" size="xs" />
    </div>
  )
}

/**
 * One course in the library. The whole card is the link (stretched title link), so the card
 * reads as a single tab stop.
 */
export function BookCard({ doc, now }: { doc: DocumentSummary; now: Date }): React.JSX.Element {
  const countdown = examCountdown(doc.examDate, now)
  const mastery = doc.mastery
  return (
    <article className="group relative flex overflow-hidden rounded-lg border border-rule bg-sheet transition-colors focus-within:border-accent hover:border-rule-strong">
      <div aria-hidden className={cx('w-1.5 shrink-0', spineClass[spineIndex(doc.id) - 1])} />
      <div className="flex min-w-0 flex-1 flex-col gap-4 p-5">
        <div className="flex flex-col gap-1">
          <h2 className="font-serif text-lg leading-snug font-semibold text-ink">
            <Link
              to={`/book/${encodeURIComponent(doc.id)}`}
              className="line-clamp-2 outline-none after:absolute after:inset-0 after:rounded-lg focus-visible:after:outline-2 focus-visible:after:outline-focus"
            >
              {doc.title}
            </Link>
          </h2>
          <p className="tabular text-sm text-graphite">
            {doc.pageCount} pages
            <span className="mx-2 text-rule-strong" aria-hidden>
              /
            </span>
            {doc.lastOpenedAt
              ? `Last read p. ${doc.lastPage}, ${relativeDay(doc.lastOpenedAt, now)}`
              : 'Not opened yet'}
          </p>
        </div>

        <IndexLine doc={doc} />

        <div className="flex flex-col gap-1.5">
          <p className="text-sm text-graphite">
            {mastery === null ? 'Mastery: not studied yet' : `Mastery ${Math.round(mastery * 100)}%`}
          </p>
          <Progress value={mastery ?? 0} label="Mastery" tone="ink" size="xs" />
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-1">
          {doc.cardsDue > 0 ? (
            <Badge tone="marker" icon="cards">
              {doc.cardsDue} {doc.cardsDue === 1 ? 'card' : 'cards'} due
            </Badge>
          ) : (
            <span className="text-sm text-faint">No cards due</span>
          )}
          {countdown ? (
            <span className={cx('flex items-center gap-1.5 text-sm', urgencyClass[countdown.urgency])}>
              <Icon name="flag" size={14} />
              {countdown.text}
            </span>
          ) : null}
        </div>
      </div>
    </article>
  )
}

export function BookCardSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="flex h-[15.5rem] overflow-hidden rounded-lg border border-rule bg-sheet">
      <div className="w-1.5 bg-sunken" />
      <div className="flex flex-1 flex-col gap-4 p-5">
        <div className="skeleton h-5 w-3/4" />
        <div className="skeleton h-3.5 w-1/2" />
        <div className="skeleton mt-3 h-1 w-full" />
        <div className="skeleton mt-3 h-1 w-full" />
        <div className="skeleton mt-auto h-6 w-24" />
      </div>
    </div>
  )
}
