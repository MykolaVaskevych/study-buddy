import type { Card } from '@shared/domain'
import { DECKS, deckLabel, deckOf, type Deck } from '@shared/decks'
import { cx } from '../../components'

export type DeckFilter = Deck | 'all'

export const inDeck = (card: Card, deck: DeckFilter): boolean => deck === 'all' || deckOf(card.type) === deck

/** Deck filter chips with card counts; decks without cards are hidden. */
export function DeckChips({
  cards,
  value,
  onChange
}: {
  cards: readonly Card[]
  value: DeckFilter
  onChange: (deck: DeckFilter) => void
}): React.JSX.Element | null {
  const counts = new Map<Deck, number>()
  for (const c of cards) counts.set(deckOf(c.type), (counts.get(deckOf(c.type)) ?? 0) + 1)
  const shown = DECKS.filter((d) => (counts.get(d) ?? 0) > 0)
  if (shown.length < 2) return null
  const chip = (deck: DeckFilter, label: string, n: number): React.JSX.Element => (
    <button
      key={deck}
      type="button"
      aria-pressed={value === deck}
      onClick={() => onChange(deck)}
      className={cx(
        'rounded-full border px-2.5 py-0.5 text-sm',
        value === deck ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-graphite hover:text-ink'
      )}
    >
      {label} <span className="tabular opacity-70">{n}</span>
    </button>
  )
  return (
    <div role="group" aria-label="Decks" className="flex flex-wrap gap-1.5">
      {chip('all', 'All', cards.length)}
      {shown.map((d) => chip(d, deckLabel[d], counts.get(d) ?? 0))}
    </div>
  )
}
