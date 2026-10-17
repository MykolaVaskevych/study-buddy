import { afterEach } from 'vitest'
import { cleanup } from '@testing-library/react'

// Guided tours auto-start on first visit; mark them seen so they don't cover screens under test.
// (Tour tests opt back in via useTour.setState.)
localStorage.setItem('sb.tours.seen', JSON.stringify(['library', 'book', 'planner', 'review', 'quiz']))

afterEach(() => {
  cleanup()
})
