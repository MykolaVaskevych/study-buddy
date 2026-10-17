import type { Ref } from 'react'
import { Link } from 'react-router'
import type { Card } from '@shared/domain'
import { useTopics } from '../../api/hooks'
import { Icon } from '../../components'
import { CardBody, cardTypeLabel } from './CardFace'

interface IndexCardProps {
  ref?: Ref<HTMLElement>
  card: Card
  flipped: boolean
  /** Shown when reviewing across books. */
  bookTitle: string | null
}

/**
 * The review card, drawn like a ruled index card: a red header rule with where the card comes
 * from, then the prompt in large serif type. Flipping adds the answer under a fold line.
 */
export function IndexCard({ ref, card, flipped, bookTitle }: IndexCardProps): React.JSX.Element {
  const topics = useTopics(card.docId)
  const topic = topics.data?.find((t) => t.id === card.topicId) ?? null
  const page = card.sourcePages[0]
  return (
    <article
      ref={ref}
      tabIndex={-1}
      aria-label={flipped ? 'Flashcard, answer shown' : 'Flashcard'}
      aria-live="polite"
      className="rounded-lg border border-rule bg-sheet shadow-page outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
    >
      <header className="flex min-w-0 items-center gap-2 border-b-2 border-redpen/45 px-8 pt-4 pb-2.5 text-sm text-graphite">
        {bookTitle ? <span className="truncate font-semibold text-ink">{bookTitle}</span> : null}
        {bookTitle && topic ? (
          <span aria-hidden className="text-rule-strong">
            /
          </span>
        ) : null}
        {topic ? <span className="truncate">{topic.title}</span> : null}
        <span className="ml-auto flex shrink-0 items-center gap-3">
          <span className="text-faint">{cardTypeLabel[card.type]}</span>
          {page ? (
            <Link
              to={`/book/${encodeURIComponent(card.docId)}?page=${page}`}
              className="tabular inline-flex items-center gap-1 rounded-sm font-semibold text-accent hover:underline"
              aria-label={`Open the source, page ${page}`}
            >
              <Icon name="file" size={14} />
              p. {page}
            </Link>
          ) : null}
        </span>
      </header>
      <div className="flex min-h-[17rem] flex-col justify-center px-8 py-9">
        <CardBody card={card} flipped={flipped} size="lg" />
      </div>
    </article>
  )
}
