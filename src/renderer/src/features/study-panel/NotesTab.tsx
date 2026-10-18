import { MyNote } from './MyNote'
import { useEffect, useState } from 'react'
import type { IndexStatus, PageNotes } from '@shared/domain'
import { usePageNotes, usePrefetchPageNotes, useStartIndex } from '../../api/hooks'
import { Badge, Button, EmptyState, Markdown, Progress, Skeleton, SkeletonText } from '../../components'
import {
  Concepts,
  Exercises,
  FormulaBlock,
  KeyPoints,
  Section,
  kindLabel,
  signalBadge
} from './notes/NoteSections'
import type { StudyTabProps } from './tabs'

/** Waits for scrolling to settle before fetching notes for a page. */
function useSettledPage(page: number, ms = 200): number {
  const [settled, setSettled] = useState(page)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(page), ms)
    return () => window.clearTimeout(t)
  }, [page, ms])
  return settled
}

function NotesSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="flex flex-col gap-6">
      <Skeleton className="h-6 w-28" />
      <SkeletonText lines={4} />
      <SkeletonText lines={3} />
    </div>
  )
}

function NotIndexed({
  docId,
  page,
  index
}: {
  docId: string
  page: number
  index: IndexStatus | null
}): React.JSX.Element {
  const start = useStartIndex()
  const running = index?.state === 'running' || index?.state === 'queued'
  return (
    <div className="flex flex-col gap-6">
      <div role="status" className="flex flex-col gap-3">
        <h3 className="font-serif text-lg font-semibold">{running ? 'Indexing…' : 'Not indexed yet'}</h3>
        <p className="text-graphite">
          {running
            ? `Claude is reading this part of the book. Notes for page ${page} appear here as soon as it is done; this page's chunk goes first.`
            : `Notes for page ${page} appear once the book is indexed.`}
        </p>
        {index ? (
          <div className="flex flex-col gap-1.5">
            <Progress
              value={index.totalPages ? index.indexedPages / index.totalPages : 0}
              label="Pages indexed"
              valueText={`${index.indexedPages} of ${index.totalPages} pages`}
              tone="accent"
              size="xs"
            />
            <p className="tabular text-xs text-graphite">
              {index.indexedPages} of {index.totalPages} pages indexed
            </p>
          </div>
        ) : null}
        {!running && index?.state !== 'done' ? (
          <div>
            <Button
              variant="primary"
              size="sm"
              loading={start.isPending}
              onClick={() => start.mutate({ docId })}
            >
              {index?.state === 'paused' ? 'Resume indexing' : 'Start indexing'}
            </Button>
          </div>
        ) : null}
      </div>
      <div aria-hidden className="flex flex-col gap-4 opacity-60">
        <SkeletonText lines={3} />
        <SkeletonText lines={2} />
      </div>
    </div>
  )
}

function Notes({
  notes,
  onCitation
}: {
  notes: PageNotes
  onCitation: (p: number) => void
}): React.JSX.Element {
  const empty =
    !notes.summary &&
    notes.keyPoints.length === 0 &&
    notes.concepts.length === 0 &&
    notes.formulas.length === 0 &&
    notes.exercises.length === 0
  return (
    <div className="flex flex-col gap-7">
      {notes.examSignals.length > 0 ? (
        <ul aria-label="Exam signals" className="flex flex-wrap gap-1.5">
          {notes.examSignals.map((s) => (
            <li key={s}>
              <Badge tone={signalBadge[s].tone} icon={signalBadge[s].icon}>
                {signalBadge[s].label}
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}

      {notes.summary ? <Markdown onCitation={onCitation}>{notes.summary}</Markdown> : null}

      {!notes.teachable && empty ? (
        <EmptyState size="sm" title="Nothing to study on this page">
          {notes.kind ? `${kindLabel[notes.kind]}. Move on to the next page.` : 'Move on to the next page.'}
        </EmptyState>
      ) : null}

      {notes.keyPoints.length > 0 ? (
        <Section title="Key points">
          <KeyPoints points={notes.keyPoints} onCitation={onCitation} />
        </Section>
      ) : null}
      {notes.formulas.length > 0 ? (
        <Section title={notes.formulas.length === 1 ? 'Formula' : 'Formulas'}>
          {notes.formulas.map((f) => (
            <FormulaBlock key={f.latex} formula={f} />
          ))}
        </Section>
      ) : null}
      {notes.concepts.length > 0 ? (
        <Section title="Concepts">
          <Concepts concepts={notes.concepts} onCitation={onCitation} />
        </Section>
      ) : null}
      {notes.exercises.length > 0 ? (
        <Section title="Try it">
          <Exercises exercises={notes.exercises} onCitation={onCitation} />
        </Section>
      ) : null}
    </div>
  )
}

/** Notes for the page being read: summary, key points, formulas with symbols, concepts, exercises. */
export function NotesTab({ docId, page, index, onCitation }: StudyTabProps): React.JSX.Element {
  const settled = useSettledPage(page)
  const notes = usePageNotes(docId, settled)
  usePrefetchPageNotes(docId, [settled + 1, settled - 1])
  const data = notes.data

  return (
    <div className="px-5 py-5">
      <header className="mb-5 flex items-baseline gap-3">
        <h2 className="tabular font-serif text-xl font-semibold">Page {page}</h2>
        {data?.label && data.label !== String(data.page) ? (
          <span className="text-sm text-graphite">labelled {data.label}</span>
        ) : null}
        {data?.kind && data.kind !== 'content' ? (
          <span className="ml-auto text-sm text-graphite">{kindLabel[data.kind]}</span>
        ) : null}
      </header>
      <MyNote docId={docId} page={page} />
      {notes.isPending || settled !== page ? (
        <NotesSkeleton />
      ) : notes.isError ? (
        <EmptyState
          size="sm"
          icon="alert"
          title="Notes did not load"
          actions={
            <Button size="sm" onClick={() => void notes.refetch()}>
              Try again
            </Button>
          }
        >
          {notes.error.message}
        </EmptyState>
      ) : data && !data.indexed ? (
        <NotIndexed docId={docId} page={page} index={index} />
      ) : data ? (
        <Notes notes={data} onCitation={onCitation} />
      ) : null}
    </div>
  )
}
