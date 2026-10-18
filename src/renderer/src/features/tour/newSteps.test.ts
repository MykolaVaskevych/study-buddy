import { act } from '@testing-library/react'
import { useTour, unseenSteps } from './tourStore'
import { stepKey, tours } from './tours'

describe('new tour steps', () => {
  it('a returning student is shown only the steps added since', () => {
    const all = tours.overview.map((s) => stepKey('overview', s))
    const missing = all[0]!
    useTour.setState({ seen: ['overview'], seenSteps: all.slice(1), active: null })
    expect(unseenSteps('overview', useTour.getState().seenSteps).map((s) => stepKey('overview', s))).toEqual([
      missing
    ])
    act(() => {
      expect(useTour.getState().startNew('overview')).toBe(true)
    })
    expect(useTour.getState().active).toMatchObject({ onlyNew: true, step: 0 })
    act(() => useTour.getState().stop())
    expect(useTour.getState().seenSteps).toContain(missing)
    expect(useTour.getState().startNew('overview')).toBe(false)
  })
})
