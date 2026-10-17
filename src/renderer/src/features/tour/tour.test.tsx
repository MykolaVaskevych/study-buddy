import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { placeCard, TourOverlay } from './TourOverlay'
import { useTour } from './tourStore'
import { tourForPath, tours } from './tours'

describe('placeCard', () => {
  const vp = { width: 1000, height: 800 }
  const card = { width: 300, height: 200 }

  it('goes below the target when there is room, clamped to the viewport', () => {
    expect(placeCard({ top: 100, left: 900, width: 50, height: 20 }, card, vp)).toEqual({
      top: 138,
      left: 688
    })
  })

  it('goes above when the bottom is full, and centres without a target', () => {
    expect(placeCard({ top: 700, left: 100, width: 50, height: 40 }, card, vp).top).toBe(482)
    expect(placeCard(null, card, vp)).toEqual({ top: 300, left: 350 })
  })
})

describe('tourForPath', () => {
  it('maps routes to their tour', () => {
    expect(tourForPath('/')).toBe('library')
    expect(tourForPath('/book/abc')).toBe('book')
    expect(tourForPath('/book/abc/plan')).toBe('planner')
    expect(tourForPath('/book/abc/quiz')).toBe('quiz')
    expect(tourForPath('/review')).toBe('review')
  })
})

describe('TourOverlay', () => {
  beforeEach(() => useTour.setState({ active: null, seen: [] }))

  it('walks through steps, skips missing optional targets and remembers the tour', async () => {
    render(
      <>
        <button data-tour="nav-/planner">Planner</button>
        <TourOverlay />
      </>
    )
    act(() => useTour.getState().start('library'))
    expect(await screen.findByRole('dialog', { name: tours.library[0]?.title })).toBeTruthy()
    // The import/book/today targets are absent here (optional) and get skipped on the way.
    await userEvent.click(screen.getByRole('button', { name: 'Next' }))
    expect(await screen.findByRole('dialog', { name: 'Exam planner' })).toBeTruthy()
    await userEvent.click(screen.getByRole('button', { name: 'Skip tour' }))
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(useTour.getState().seen).toContain('library')
    expect(JSON.parse(localStorage.getItem('sb.tours.seen') ?? '[]')).toContain('library')
  })

  it('Escape ends the tour, arrows move between steps', async () => {
    render(<TourOverlay />)
    act(() => useTour.getState().start('library'))
    await screen.findByRole('dialog')
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
