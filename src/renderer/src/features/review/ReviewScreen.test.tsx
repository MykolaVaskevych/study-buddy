import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import type { Card } from '@shared/domain'
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

  it('shows rounds and offers a break when cards keep coming back the day before the exam', async () => {
    const { mock } = renderApp('/review?book=optical-networks')
    const original = mock.invoke.bind(mock)
    vi.spyOn(mock, 'invoke').mockImplementation(async (channel, input) => {
      const result = await original(channel, input)
      // Like main near an exam: every rated card is due again within minutes.
      if (channel === 'cards.review' && result.ok) {
        const card = result.data as Card
        card.srs = { ...card.srs, due: new Date(Date.now() + 60_000).toISOString() }
      }
      return result
    })
    const user = userEvent.setup()
    let sawRound = false
    for (let i = 0; i < 80 && !screen.queryByRole('region', { name: 'Take a break' }); i++) {
      await screen.findByRole('article', { name: 'Flashcard' })
      if (screen.queryByText(/^Round 2 ·/)) sawRound = true
      await user.keyboard(' ')
      await screen.findByRole('article', { name: 'Flashcard, answer shown' })
      await user.keyboard('3')
      await waitFor(() =>
        expect(screen.queryByRole('article', { name: 'Flashcard, answer shown' })).toBeNull()
      )
    }
    expect(sawRound).toBe(true)
    const pause = await screen.findByRole('region', { name: 'Take a break' })
    expect(within(pause).getByText(/Every card done 2 times/)).toBeTruthy()
    await user.click(within(pause).getByRole('button', { name: 'Finish for now' }))
    expect(await screen.findByRole('heading', { name: 'Done for now' })).toBeTruthy()
  })
})
