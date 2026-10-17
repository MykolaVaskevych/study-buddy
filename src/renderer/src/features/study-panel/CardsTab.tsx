import { useCardStats } from '../../api/hooks'
import { EmptyState, Skeleton } from '../../components'
import type { StudyTabProps } from './tabs'

/**
 * Placeholder with live counts. Wave 2 (issue #6) replaces it with card generation for the page
 * (`useGenerateCards()` with a page scope) and the review flow (`useDueCards`, `useReviewCard`).
 */
export function CardsTab({ docId }: StudyTabProps): React.JSX.Element {
  const stats = useCardStats(docId)
  const s = stats.data
  return (
    <div className="flex flex-col gap-6 px-5 py-6">
      {s ? (
        <dl className="grid grid-cols-3 gap-3">
          {(
            [
              ['Due now', s.due],
              ['New', s.new],
              ['In this book', s.total]
            ] as const
          ).map(([label, value]) => (
            <div key={label} className="rounded-lg bg-sunken px-3 py-2.5">
              <dt className="text-xs text-graphite">{label}</dt>
              <dd className="tabular font-serif text-xl font-semibold">{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <Skeleton className="h-16 w-full" />
      )}
      <EmptyState icon="cards" title="Flashcards for this page">
        <p>
          Make cards from the page you are reading and review them before the exam. Arrives in the next build.
        </p>
      </EmptyState>
    </div>
  )
}
