import { useEffect, useMemo, useState } from 'react'
import type { PlanInput, PlanTopic } from '@shared/planner'
import { computePreview } from './preview'
import type { Preview } from './preview'

/**
 * How long the input must stay still before the preview re-solves. The solver takes a few
 * milliseconds; the pause keeps a dragged slider from queueing a solve per pixel.
 */
export const PREVIEW_DEBOUNCE_MS = 50

/** `value`, updated only after it has stopped changing for `ms` milliseconds. */
export function useDebouncedValue<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(timer)
  }, [value, ms])
  return settled
}

/** The live plan for the input being edited: solved and scheduled in the renderer, memoized. */
export function usePlannerPreview(topics: PlanTopic[], input: PlanInput, today: string): Preview {
  const settled = useDebouncedValue(input, PREVIEW_DEBOUNCE_MS)
  return useMemo(() => computePreview(topics, settled, today), [topics, settled, today])
}
