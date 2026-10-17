import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router'
import { useDueCards, useLibrary } from '../../api/hooks'
import { Button, cx, EmptyState, Skeleton } from '../../components'
import { fieldClass } from '../study/form'
import { ReviewSession } from './ReviewSession'

function SessionSkeleton(): React.JSX.Element {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <Skeleton className="h-6 w-64" />
      <div className="flex min-h-[21rem] flex-col gap-4 rounded-lg border border-rule bg-sheet px-8 py-6">
        <Skeleton className="h-4 w-48" />
        <Skeleton className="mt-12 h-6 w-3/4" />
        <Skeleton className="h-6 w-1/2" />
      </div>
      <Skeleton className="h-11 w-full rounded-md" />
    </div>
  )
}

/** Review: due flashcards from every book (or one), scheduled by FSRS against the exam date. */
export function ReviewScreen(): React.JSX.Element {
  const [params, setParams] = useSearchParams()
  const docId = params.get('book')
  const library = useLibrary()
  const due = useDueCards(docId, 200)
  const [round, setRound] = useState(0)
  const books = useMemo(() => library.data ?? [], [library.data])
  const titles = useMemo(() => new Map(books.map((b) => [b.id, b.title])), [books])

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-8 py-9">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <h1 className="font-serif text-2xl font-semibold">Review</h1>
          <label className="ml-auto flex items-center gap-2 text-sm text-graphite">
            Cards from
            <select
              value={docId ?? ''}
              onChange={(e) => setParams(e.target.value ? { book: e.target.value } : {})}
              className={cx(fieldClass, 'h-8 max-w-64 pr-8')}
            >
              <option value="">All books</option>
              {books.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.title}
                  {b.cardsDue > 0 ? ` (${b.cardsDue} due)` : ''}
                </option>
              ))}
            </select>
          </label>
        </header>

        {due.isPending ? (
          <SessionSkeleton />
        ) : due.data ? (
          <ReviewSession
            key={`${docId ?? 'all'}:${round}`}
            initial={due.data}
            docId={docId}
            bookTitles={titles}
            dueNow={due.data.length}
            onRestart={() => setRound((r) => r + 1)}
          />
        ) : (
          <EmptyState
            icon="alert"
            title="Your due cards did not load"
            actions={<Button onClick={() => void due.refetch()}>Try again</Button>}
          >
            {due.error?.message}
          </EmptyState>
        )}
      </div>
    </div>
  )
}
