import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const reviewCalls = (invoke: { mock: { calls: unknown[][] } }) =>
  invoke.mock.calls.filter(([channel]) => channel === 'cards.review').map(([, input]) => input)

describe('ReviewScreen', () => {
  it('flips with Space and rates with 1–4 through cards.review', async () => {
    const { mock } = renderApp('/review')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    expect(await screen.findByRole('article', { name: 'Flashcard' })).toBeTruthy()

    // Ratings only count once the answer is shown.
    await user.keyboard('3')
    expect(reviewCalls(invoke)).toHaveLength(0)

    await user.keyboard(' ')
    expect(await screen.findByRole('article', { name: 'Flashcard, answer shown' })).toBeTruthy()
    await user.keyboard('3')
    await waitFor(() => expect(reviewCalls(invoke)).toHaveLength(1))

    await user.keyboard(' ')
    await screen.findByRole('article', { name: 'Flashcard, answer shown' })
    await user.keyboard('1')
    await waitFor(() => expect(reviewCalls(invoke)).toHaveLength(2))

    const [first, second] = reviewCalls(invoke) as { cardId: string; rating: number; elapsedMs: number }[]
    expect(first).toMatchObject({ rating: 3 })
    expect(second).toMatchObject({ rating: 1 })
    expect(first?.cardId).not.toBe(second?.cardId)
    expect(first?.elapsedMs).toBeGreaterThanOrEqual(0)
    // Session stats: two reviews, one recalled (Good) and one lapsed (Again).
    const stats = screen.getByText(/^Card \d+ of/).parentElement?.textContent
    expect(stats).toContain('2reviewed')
    expect(stats).toContain('Recall50%')
  })

  it('moves with j/k and links the source page', async () => {
    renderApp('/review?book=optical-networks')
    const user = userEvent.setup()
    await screen.findByRole('article', { name: 'Flashcard' })
    expect(screen.getByText(/^Card 1 of/)).toBeTruthy()
    await user.keyboard('j')
    expect(screen.getByText(/^Card 2 of/)).toBeTruthy()
    await user.keyboard('k')
    expect(screen.getByText(/^Card 1 of/)).toBeTruthy()
    const source = screen.getByRole('link', { name: /Open the source, page \d+/ })
    expect(source.getAttribute('href')).toMatch(/^\/book\/optical-networks\?page=\d+$/)
  })

  it('shows when the next card is due when nothing is due', async () => {
    renderApp('/review?book=probability-notes')
    expect(await screen.findByRole('heading', { name: 'Nothing due right now' })).toBeTruthy()
    expect(await screen.findByText(/The next card is due in 6 days/)).toBeTruthy()
  })
})
