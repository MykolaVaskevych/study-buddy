import { create } from 'zustand'
import { tours, type TourId } from './tours'

const STORAGE_KEY = 'sb.tours.seen'

function loadSeen(): TourId[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? (parsed.filter((x) => typeof x === 'string') as TourId[]) : []
  } catch {
    return []
  }
}

function saveSeen(seen: TourId[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(seen))
  } catch {
    // Private mode or blocked storage: tours may show again next time, which is harmless.
  }
}

interface TourState {
  active: { id: TourId; step: number } | null
  seen: TourId[]
  start: (id: TourId) => void
  /** Move by +1/−1; finishing the last step ends the tour. */
  go: (delta: 1 | -1) => void
  /** End the tour (finished or skipped) and remember it was seen. */
  stop: () => void
  /** Forget every seen tour so they show again on each screen. */
  reset: () => void
}

export const useTour = create<TourState>((set, get) => ({
  active: null,
  seen: loadSeen(),
  start: (id) => set({ active: { id, step: 0 } }),
  go: (delta) => {
    const { active } = get()
    if (!active) return
    const step = active.step + delta
    if (step < 0) return
    if (step >= tours[active.id].length) return get().stop()
    set({ active: { ...active, step } })
  },
  stop: () => {
    const { active, seen } = get()
    if (!active) return
    const next = seen.includes(active.id) ? seen : [...seen, active.id]
    saveSeen(next)
    set({ active: null, seen: next })
  },
  reset: () => {
    saveSeen([])
    set({ seen: [] })
  }
}))
