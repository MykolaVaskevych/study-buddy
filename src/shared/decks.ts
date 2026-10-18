import type { CardType } from './domain'

/** Flashcard decks within a book: what kind of knowledge a card trains. */
export type Deck = 'concepts' | 'why' | 'compare' | 'formulas' | 'mistakes'

export const DECKS: readonly Deck[] = ['concepts', 'why', 'compare', 'formulas', 'mistakes']

export const deckLabel: Record<Deck, string> = {
  concepts: 'Concepts',
  why: 'Why & how',
  compare: 'Compare',
  formulas: 'Formulas',
  mistakes: 'My mistakes'
}

export function deckOf(type: CardType): Deck {
  switch (type) {
    case 'formula':
      return 'formulas'
    case 'contrast':
      return 'compare'
    case 'why':
      return 'why'
    case 'mistake':
      return 'mistakes'
    case 'basic':
    case 'cloze':
      return 'concepts'
  }
}
