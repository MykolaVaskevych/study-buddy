import { useEffect } from 'react'
import { unseenSteps, useTour } from './tourStore'
import type { TourId } from './tours'

/**
 * Starts a screen's tour on the first visit, once its content has rendered (`ready`). Later
 * visits show only steps added since (new features), so updates explain themselves.
 */
export function useAutoTour(id: TourId, ready = true): void {
  const seen = useTour((s) => s.seen.includes(id))
  const fresh = useTour((s) => unseenSteps(id, s.seenSteps).length)
  const busy = useTour((s) => s.active !== null)
  const start = useTour((s) => s.start)
  const startNew = useTour((s) => s.startNew)
  useEffect(() => {
    if (!ready || busy || (seen && fresh === 0)) return
    const timer = setTimeout(() => (seen ? startNew(id) : start(id)), 700)
    return () => clearTimeout(timer)
  }, [id, ready, seen, fresh, busy, start, startNew])
}
