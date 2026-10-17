import { useState } from 'react'
import type { Card } from '@shared/domain'
import { useSetCardStatus } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Badge, cx, IconButton } from '../../components'
import { CardBody, cardTypeLabel } from '../review/CardFace'

interface CardItemProps {
  card: Card
  onEdit: (card: Card) => void
  onCitation: (page: number) => void
}

/** A flashcard in the study panel: flip to check yourself, edit, suspend or report it. */
export function CardItem({ card, onEdit, onCitation }: CardItemProps): React.JSX.Element {
  const [flipped, setFlipped] = useState(false)
  const setStatus = useSetCardStatus()
  const inactive = card.status !== 'active'
  const page = card.sourcePages[0]

  const changeStatus = (status: Card['status']): void => {
    setStatus.mutate(
      { cardId: card.id, status },
      {
        onSuccess: () =>
          toast({
            tone: 'ok',
            title:
              status === 'suspended'
                ? 'Card suspended'
                : status === 'reported'
                  ? 'Card reported'
                  : 'Card back in your reviews',
            body:
              status === 'active' ? undefined : 'It will not come up in reviews. Restore it here any time.'
          })
      }
    )
  }

  return (
    <li
      className={cx(
        'flex flex-col rounded-lg border bg-sheet',
        inactive ? 'border-dashed border-rule-strong' : 'border-rule'
      )}
    >
      {/* Mouse convenience; keyboard users have the Show answer button below. */}
      <div
        className={cx('flex cursor-pointer flex-col gap-3 px-4 pt-3.5 pb-3', inactive && 'opacity-60')}
        onClick={() => setFlipped((f) => !f)}
      >
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
          <span>{cardTypeLabel[card.type]}</span>
          {card.essential ? <Badge tone="marker">Essential</Badge> : null}
          {card.verification === 'unverified' ? <Badge tone="neutral">Not verified</Badge> : null}
          {card.status === 'suspended' ? <Badge tone="neutral">Suspended</Badge> : null}
          {card.status === 'reported' ? <Badge tone="redpen">Reported</Badge> : null}
        </div>
        <CardBody card={card} flipped={flipped} />
      </div>
      <div className="flex items-center gap-2 px-2 pb-2 pl-4">
        <button
          type="button"
          aria-expanded={flipped}
          onClick={() => setFlipped((f) => !f)}
          className="rounded-sm text-sm font-semibold whitespace-nowrap text-accent hover:underline"
        >
          {flipped ? 'Hide answer' : 'Show answer'}
        </button>
        <span className="ml-auto flex shrink-0 items-center">
          {page ? (
            <button
              type="button"
              onClick={() => onCitation(page)}
              aria-label={`Go to page ${page}`}
              className="tabular mr-1 rounded-sm px-1 text-xs text-graphite hover:text-ink"
            >
              p. {page}
            </button>
          ) : null}
          <IconButton icon="pencil" label="Edit card" size="sm" onClick={() => onEdit(card)} />
          {inactive ? (
            <IconButton icon="play" label="Restore card" size="sm" onClick={() => changeStatus('active')} />
          ) : (
            <>
              <IconButton
                icon="pause"
                label="Suspend card"
                size="sm"
                onClick={() => changeStatus('suspended')}
              />
              <IconButton
                icon="flag"
                label="Report card"
                size="sm"
                onClick={() => changeStatus('reported')}
              />
            </>
          )}
        </span>
      </div>
    </li>
  )
}
