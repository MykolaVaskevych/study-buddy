import { create } from 'zustand'
import { stepKey, tours, type TourId, type TourStep } from './tours'

const STORAGE_KEY = 'sb.tours.seen'
const STEPS_KEY = 'sb.tours.seenSteps'

/**
 * Steps that existed in v0.1.0, before seen steps were tracked one by one. Users who had already
 * finished a tour then saw these; anything added since is shown to them as "new".
 */
const V010_STEPS: Record<TourId, string[]> = {
  library: [
    'title:Welcome to Study Buddy',
    '[data-tour="import"]',
    '[data-tour="book-card"]',
    '[data-tour="today"]',
    '[data-tour="nav-/planner"]',
    '[data-tour="nav-/review"]',
    '[data-tour="help"]'
  ],
  book: [
    '[data-tour="course-map"]',
    '[data-tour="reader"]',
    '[role="tab"][id$="-tab-notes"]',
    '[role="tab"][id$="-tab-test"]',
    '[role="tab"][id$="-tab-cards"]',
    '[role="tab"][id$="-tab-chat"]',
    '[data-tour="bookmark"]',
    '[data-tour="study-tools"]'
  ],
  studybook: ['[data-tour="studybook-toc"]', '[data-tour="write-all"]'],
  portal: [],
  overview: ['[data-tour="ai-status"]', '[data-tour="prepare"]', '[data-tour="my-progress"]'],
  planner: [
    '[data-tour="plan-form"]',
    '[data-tour="plan-score"]',
    '[data-tour="triage"]',
    '[data-tour="past-papers"]',
    '[data-tour="schedule"]',
    '[data-tour="save-plan"]'
  ],
  review: ['[data-tour="review-card"]', '[data-tour="review-ratings"]', '[data-tour="export-anki"]'],
  quiz: ['[data-tour="quiz-setup"]']
}

function read(key: string): string[] | null {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return null
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return null
  }
}

function write(key: string, value: readonly string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Private mode or blocked storage: tours may show again next time, which is harmless.
  }
}

function loadSeenSteps(seenTours: readonly TourId[]): string[] {
  const stored = read(STEPS_KEY)
  if (stored !== null) return stored
  // First run with per-step tracking: finished tours count as seen up to their v0.1.0 steps.
  return seenTours.flatMap((t) => (V010_STEPS[t] ?? []).map((k) => `${t}:${k}`))
}

interface ActiveTour {
  id: TourId
  step: number
  steps: TourStep[]
  /** Only the steps added since the student last took this tour. */
  onlyNew: boolean
}

interface TourState {
  active: ActiveTour | null
  seen: TourId[]
  seenSteps: string[]
  /** Full tour (first visit, or the ? button). */
  start: (id: TourId) => void
  /** Just the steps of this tour the student has not seen yet; false if there are none. */
  startNew: (id: TourId) => boolean
  /** Move by +1/−1; finishing the last step ends the tour. */
  go: (delta: 1 | -1) => void
  /** End the tour (finished or skipped): the tour and all its steps count as seen. */
  stop: () => void
  /** Forget everything so tours show again on each screen. */
  reset: () => void
}

/** Steps of a tour the student has not seen. */
export function unseenSteps(id: TourId, seenSteps: readonly string[]): TourStep[] {
  const seen = new Set(seenSteps)
  return tours[id].filter((s) => !seen.has(stepKey(id, s)))
}

const initialSeen = (read(STORAGE_KEY) ?? []) as TourId[]

export const useTour = create<TourState>((set, get) => ({
  active: null,
  seen: initialSeen,
  seenSteps: loadSeenSteps(initialSeen),
  start: (id) => set({ active: { id, step: 0, steps: tours[id], onlyNew: false } }),
  startNew: (id) => {
    const steps = unseenSteps(id, get().seenSteps)
    if (steps.length === 0) return false
    set({ active: { id, step: 0, steps, onlyNew: true } })
    return true
  },
  go: (delta) => {
    const { active } = get()
    if (!active) return
    const step = active.step + delta
    if (step < 0) return
    if (step >= active.steps.length) return get().stop()
    set({ active: { ...active, step } })
  },
  stop: () => {
    const { active, seen, seenSteps } = get()
    if (!active) return
    const nextSeen = seen.includes(active.id) ? seen : [...seen, active.id]
    const nextSteps = [...new Set([...seenSteps, ...tours[active.id].map((s) => stepKey(active.id, s))])]
    write(STORAGE_KEY, nextSeen)
    write(STEPS_KEY, nextSteps)
    set({ active: null, seen: nextSeen, seenSteps: nextSteps })
  },
  reset: () => {
    write(STORAGE_KEY, [])
    write(STEPS_KEY, [])
    set({ seen: [], seenSteps: [] })
  }
}))
