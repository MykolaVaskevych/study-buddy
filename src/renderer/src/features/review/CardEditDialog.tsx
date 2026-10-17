import { useState } from 'react'
import type { Card } from '@shared/domain'
import { useUpdateCard } from '../../api/hooks'
import { Button, cx, Dialog, Kbd } from '../../components'
import { fieldClass } from '../study/form'

function EditForm({
  card,
  onClose,
  onSaved
}: {
  card: Card
  onClose: () => void
  onSaved: (card: Card) => void
}): React.JSX.Element {
  const update = useUpdateCard()
  const [front, setFront] = useState(card.front)
  const [back, setBack] = useState(card.back)
  const valid = front.trim().length > 0 && back.trim().length > 0
  const save = (): void => {
    if (!valid) return
    update.mutate(
      { cardId: card.id, front: front.trim(), back: back.trim() },
      {
        onSuccess: (saved) => {
          onSaved(saved)
          onClose()
        }
      }
    )
  }
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-graphite">Front</span>
        <textarea
          rows={3}
          value={front}
          onChange={(e) => setFront(e.target.value)}
          onKeyDown={onKeyDown}
          className={cx(fieldClass, 'h-auto resize-y py-2 font-serif')}
        />
        {card.type === 'cloze' ? (
          <span className="text-xs text-graphite">
            Write gaps as <code className="font-mono">{'{{c1::answer}}'}</code>, or{' '}
            <code className="font-mono">{'{{c1::answer::hint}}'}</code>. Math goes between $ signs.
          </span>
        ) : (
          <span className="text-xs text-graphite">Markdown, with math between $ signs.</span>
        )}
      </label>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-graphite">
          {card.type === 'cloze' ? 'Extra note' : 'Back'}
        </span>
        <textarea
          rows={4}
          value={back}
          onChange={(e) => setBack(e.target.value)}
          onKeyDown={onKeyDown}
          className={cx(fieldClass, 'h-auto resize-y py-2 font-serif')}
        />
      </label>
      <div className="flex items-center justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" disabled={!valid} loading={update.isPending}>
          Save card <Kbd keys="Mod+Enter" tone="inverse" />
        </Button>
      </div>
    </form>
  )
}

interface CardEditDialogProps {
  /** null = closed. */
  card: Card | null
  onClose: () => void
  onSaved: (card: Card) => void
}

/** Fix a card's wording without leaving the review. */
export function CardEditDialog({ card, onClose, onSaved }: CardEditDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={card !== null}
      onClose={onClose}
      title="Edit card"
      className="w-[min(40rem,calc(100vw-2rem))]"
    >
      {card ? <EditForm card={card} onClose={onClose} onSaved={onSaved} /> : null}
    </Dialog>
  )
}
