import { useState } from 'react'
import { Link } from 'react-router'
import type { Card, Scope, Topic } from '@shared/domain'
import { useCardStats, useCards, useDocument, useTopics } from '../../api/hooks'
import { Button, cx, EmptyState, Icon, Skeleton } from '../../components'
import { topicAt } from '../reader/topicTree'
import { CardEditDialog } from '../review/CardEditDialog'
import type { StudyTabProps } from '../study-panel/tabs'
import { CardItem } from './CardItem'
import { fieldClass, Segmented } from './form'
import { GenerateCards } from './GenerateCards'
import { useSettledValue } from './useSettledValue'

type ScopeKind = 'page' | 'topic' | 'range'

interface Range {
  from: number
  to: number
}

function parseRange(draft: { from: string; to: string }, pageCount: number): Range | null {
  const from = Number(draft.from)
  const to = Number(draft.to)
  if (!Number.isInteger(from) || !Number.isInteger(to)) return null
  if (from < 1 || to > pageCount || from > to) return null
  return { from, to }
}

function RangeFields({
  draft,
  onChange,
  pageCount,
  valid
}: {
  draft: { from: string; to: string }
  onChange: (draft: { from: string; to: string }) => void
  pageCount: number
  valid: boolean
}): React.JSX.Element {
  const field = cx(fieldClass, 'tabular h-8 w-16 px-2 text-center')
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-graphite">
      <label className="flex items-center gap-1.5">
        Pages
        <input
          inputMode="numeric"
          aria-label="From page"
          value={draft.from}
          onChange={(e) => onChange({ ...draft, from: e.target.value.replace(/\D/g, '') })}
          className={field}
        />
      </label>
      <label className="flex items-center gap-1.5">
        to
        <input
          inputMode="numeric"
          aria-label="To page"
          value={draft.to}
          onChange={(e) => onChange({ ...draft, to: e.target.value.replace(/\D/g, '') })}
          className={field}
        />
      </label>
      {!valid ? (
        <span role="alert" className="text-redpen">
          Use pages 1 to {pageCount}, first page first.
        </span>
      ) : null}
    </div>
  )
}

function scopeOf(kind: ScopeKind, docId: string, page: number, topic: Topic | null, range: Range): Scope {
  if (kind === 'topic' && topic) return { kind: 'topic', docId, topicId: topic.id }
  if (kind === 'range') return { kind: 'range', docId, from: range.from, to: range.to }
  return { kind: 'page', docId, page }
}

/** Flashcards for the page, topic or page range being read, and the buttons that write more. */
export function CardsTab({ docId, page, onCitation }: StudyTabProps): React.JSX.Element {
  const settled = useSettledValue(page)
  const doc = useDocument(docId)
  const topics = useTopics(docId)
  const stats = useCardStats(docId)
  const topic = topicAt(topics.data ?? [], settled)
  const pageCount = doc.data?.pageCount ?? Math.max(settled, 1)
  const [kind, setKind] = useState<ScopeKind>('page')
  const [rangeDraft, setRangeDraft] = useState<{ from: string; to: string } | null>(null)
  const [editing, setEditing] = useState<Card | null>(null)

  const draft = rangeDraft ?? { from: String(settled), to: String(Math.min(pageCount, settled + 4)) }
  const parsed = parseRange(draft, pageCount)
  const effective: ScopeKind = kind === 'topic' && !topic ? 'page' : kind
  const range = parsed ?? { from: settled, to: settled }
  const scope = scopeOf(effective, docId, settled, topic, range)
  const cards = useCards(scope, true)
  const list = cards.data ?? []
  const label =
    effective === 'topic' && topic
      ? topic.title
      : effective === 'range'
        ? `pages ${range.from}–${range.to}`
        : `page ${settled}`
  const active = list.filter((c) => c.status === 'active').length

  return (
    <div className="flex flex-col gap-5 px-5 py-5">
      <div className="flex flex-col gap-3">
        <Segmented
          label="Show cards for"
          value={effective}
          onChange={(k) => {
            setKind(k)
            if (k === 'range') setRangeDraft(null)
          }}
          options={[
            { value: 'page', label: `Page ${settled}` },
            { value: 'topic', label: 'This topic', disabled: !topic },
            { value: 'range', label: 'Pages…' }
          ]}
        />
        {effective === 'range' ? (
          <RangeFields draft={draft} onChange={setRangeDraft} pageCount={pageCount} valid={parsed !== null} />
        ) : effective === 'topic' && topic ? (
          <p className="text-sm text-graphite">
            {topic.title}, pp. {topic.pageStart}–{topic.pageEnd}
          </p>
        ) : null}
      </div>

      {effective !== 'range' || parsed ? <GenerateCards scope={scope} scopeLabel={label} /> : null}

      <section aria-label={`Cards for ${label}`} className="flex flex-col gap-3">
        <header className="flex items-baseline justify-between gap-3">
          <h2 className="font-serif text-lg font-semibold">
            {cards.isPending
              ? 'Cards'
              : list.length === 0
                ? 'No cards yet'
                : `${list.length} card${list.length === 1 ? '' : 's'}`}
          </h2>
          {list.length > active ? <span className="text-sm text-graphite">{active} in reviews</span> : null}
        </header>
        {cards.isPending ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ) : cards.isError ? (
          <EmptyState
            size="sm"
            icon="alert"
            title="Cards did not load"
            actions={
              <Button size="sm" onClick={() => void cards.refetch()}>
                Try again
              </Button>
            }
          >
            {cards.error.message}
          </EmptyState>
        ) : list.length === 0 ? (
          <p className="max-w-[46ch] text-sm text-graphite">
            Nothing for {label} yet. Start with the essentials: the few cards that carry most of the marks.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {list.map((c) => (
              <CardItem key={c.id} card={c} onEdit={setEditing} onCitation={onCitation} />
            ))}
          </ul>
        )}
      </section>

      {stats.data && stats.data.due > 0 ? (
        <Link
          to={`/review?book=${encodeURIComponent(docId)}`}
          className="flex items-center gap-2 self-start rounded-md text-sm font-semibold text-accent hover:underline"
        >
          <Icon name="review" size={16} />
          Review {stats.data.due} due card{stats.data.due === 1 ? '' : 's'} from this book
        </Link>
      ) : null}

      <CardEditDialog card={editing} onClose={() => setEditing(null)} onSaved={() => undefined} />
    </div>
  )
}
