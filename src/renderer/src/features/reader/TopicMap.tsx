import { useState } from 'react'
import type { DocumentDetail, IndexStatus, Topic } from '@shared/domain'
import { useRebuildTopics, useStartIndex, useTopics } from '../../api/hooks'
import { Button, cx, EmptyState, Icon, Progress, Skeleton } from '../../components'
import { buildTopicTree, topicAt } from './topicTree'
import type { TopicNode } from './topicTree'

interface Props {
  doc: DocumentDetail
  index: IndexStatus
  page: number
  onJump: (page: number) => void
}

function pages(t: Topic): string {
  return t.pageStart === t.pageEnd ? `p. ${t.pageStart}` : `pp. ${t.pageStart}–${t.pageEnd}`
}

function TopicRow({
  node,
  depth,
  currentId,
  onJump
}: {
  node: TopicNode
  depth: number
  currentId: string | null
  onJump: (page: number) => void
}): React.JSX.Element {
  const { topic, children } = node
  const [open, setOpen] = useState(true)
  const current = topic.id === currentId
  const weight = topic.estimates?.examWeight
  return (
    <li>
      <div
        className={cx('group relative flex items-start gap-1 rounded-md pr-2', current && 'bg-marker-soft')}
        style={{ paddingLeft: depth * 14 + 4 }}
      >
        {current ? (
          <span aria-hidden className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-marker" />
        ) : null}
        {children.length > 0 ? (
          <button
            type="button"
            aria-label={open ? `Collapse ${topic.title}` : `Expand ${topic.title}`}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="mt-2 inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-faint hover:text-ink"
          >
            <Icon
              name="chevron-down"
              size={14}
              className={cx('transition-transform', !open && '-rotate-90')}
            />
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <button
          type="button"
          onClick={() => onJump(topic.pageStart)}
          aria-current={current ? 'location' : undefined}
          className="flex min-w-0 flex-1 flex-col gap-1.5 rounded-sm py-2 text-left"
        >
          <span className={cx('text-sm leading-snug', depth === 0 ? 'font-semibold text-ink' : 'text-ink')}>
            {topic.title}
          </span>
          <span className="tabular flex items-center gap-2 text-xs text-graphite">
            {pages(topic)}
            {weight !== undefined ? (
              <span className="text-faint">{Math.round(weight * 100)}% of marks</span>
            ) : null}
          </span>
          <Progress
            value={topic.mastery ?? 0}
            label={`Mastery of ${topic.title}`}
            valueText={topic.mastery === null ? 'Not studied yet' : `${Math.round(topic.mastery * 100)}%`}
            size="xs"
            tone={topic.mastery !== null && topic.mastery >= 0.75 ? 'ok' : 'ink'}
          />
        </button>
      </div>
      {open && children.length > 0 ? (
        <ul>
          {children.map((c) => (
            <TopicRow key={c.topic.id} node={c} depth={depth + 1} currentId={currentId} onJump={onJump} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function NotBuilt({ doc, index }: { doc: DocumentDetail; index: IndexStatus }): React.JSX.Element {
  const start = useStartIndex()
  const rebuild = useRebuildTopics()
  const done = index.state === 'done'
  const running = index.state === 'running' || index.state === 'queued'
  return (
    <EmptyState
      size="sm"
      icon="map"
      title="No course map yet"
      actions={
        done ? (
          <Button size="sm" loading={rebuild.isPending} onClick={() => rebuild.mutate({ docId: doc.id })}>
            Build course map
          </Button>
        ) : !running ? (
          <Button size="sm" loading={start.isPending} onClick={() => start.mutate({ docId: doc.id })}>
            Start indexing
          </Button>
        ) : null
      }
    >
      {done ? (
        <p>All pages are indexed. Build the map to see topics, page ranges and exam weight.</p>
      ) : running ? (
        <div className="flex flex-col gap-2">
          <p>
            The map is built once indexing finishes: {index.indexedPages} of {index.totalPages} pages so far.
          </p>
          <Progress
            value={index.totalPages ? index.indexedPages / index.totalPages : 0}
            label="Pages indexed"
            tone="accent"
            size="xs"
          />
        </div>
      ) : (
        <p>Index the book first; the map groups its pages into topics with exam weights.</p>
      )}
    </EmptyState>
  )
}

/** The open file's topics with page ranges and mastery, following the reader's position. */
export function TopicMap({ doc, index, page, onJump }: Props): React.JSX.Element {
  const topics = useTopics(doc.id)
  const list = topics.data ?? []
  const current = topicAt(list, page)

  return (
    <>
      {topics.isPending ? (
        <div className="flex flex-col gap-4 px-3 pt-2">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex flex-col gap-2">
              <Skeleton className="h-3.5 w-4/5" />
              <Skeleton className="h-1 w-full" />
            </div>
          ))}
        </div>
      ) : list.length === 0 ? (
        <div className="flex flex-col gap-6 px-3 pt-2">
          <NotBuilt doc={doc} index={index} />
          {doc.outline.length > 0 ? (
            <nav aria-label="Contents from the PDF" className="flex flex-col gap-1">
              <h3 className="text-xs font-semibold text-graphite">Contents from the PDF</h3>
              <ul>
                {doc.outline.map((item, i) => (
                  <li key={`${item.title}-${i}`}>
                    <button
                      type="button"
                      disabled={item.page === null}
                      onClick={() => item.page !== null && onJump(item.page)}
                      className="flex w-full justify-between gap-3 rounded-sm py-1.5 text-left text-sm hover:text-accent"
                    >
                      <span className="truncate">{item.title}</span>
                      {item.page !== null ? <span className="tabular text-faint">{item.page}</span> : null}
                    </button>
                  </li>
                ))}
              </ul>
            </nav>
          ) : null}
        </div>
      ) : (
        <ul aria-label="Topics">
          {buildTopicTree(list).map((node) => (
            <TopicRow
              key={node.topic.id}
              node={node}
              depth={0}
              currentId={current?.id ?? null}
              onJump={onJump}
            />
          ))}
        </ul>
      )}
    </>
  )
}
