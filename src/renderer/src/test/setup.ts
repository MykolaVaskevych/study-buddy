import { stepKey, tours, type TourId } from '../features/tour/tours'
import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Guided tours auto-start on first visit; mark them seen so they don't cover screens under test.
// (Tour tests opt back in via useTour.setState.)
localStorage.setItem('sb.tours.seen', JSON.stringify(Object.keys(tours)))

// Every current step counts as seen too, so "new steps" mini tours don't start either.
localStorage.setItem(
  'sb.tours.seenSteps',
  JSON.stringify((Object.keys(tours) as TourId[]).flatMap((id) => tours[id].map((step) => stepKey(id, step))))
)
// An unknown "last seen" entry means nothing is pending, so What's new does not open.
localStorage.setItem('sb.whatsnew.lastSeen', 'test-setup')

afterEach(() => {
  cleanup()
})
