import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { Card } from '@shared/domain'
import { DeckChips, inDeck } from './DeckChips'

const card = (id: string, type: Card['type']): Card => ({ id, type }) as Card

describe('DeckChips', () => {
  it('shows decks with counts and filters by deck', async () => {
    const cards = [card('1', 'formula'), card('2', 'why'), card('3', 'why'), card('4', 'mistake')]
    const onChange = vi.fn()
    render(<DeckChips cards={cards} value="all" onChange={onChange} />)
    expect(screen.getByRole('button', { name: /Why & how 2/ })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: /My mistakes 1/ }))
    expect(onChange).toHaveBeenCalledWith('mistakes')
    expect(cards.filter((c) => inDeck(c, 'formulas')).map((c) => c.id)).toEqual(['1'])
  })
})
