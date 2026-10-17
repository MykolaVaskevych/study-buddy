import { useEffect } from 'react'
import { useTour } from './tourStore'
import type { TourId } from './tours'

/** Starts a screen's tour on the first visit, once its content has rendered (`ready`). */
export function useAutoTour(id: TourId, ready = true): void {
  const seen = useTour((s) => s.seen.includes(id))
  const busy = useTour((s) => s.active !== null)
  const start = useTour((s) => s.start)
  useEffect(() => {
    if (!ready || seen || busy) return
    const timer = setTimeout(() => start(id), 700)
    return () => clearTimeout(timer)
  }, [id, ready, seen, busy, start])
}
