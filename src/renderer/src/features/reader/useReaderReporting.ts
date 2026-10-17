import { useEffect, useRef } from 'react'
import { useIndexFocus, useSetLastPage, useTrackReading } from '../../api/hooks'
import { ReadingTracker } from './readingTracker'

const LAST_PAGE_DEBOUNCE_MS = 800
const FOCUS_SETTLE_MS = 1200
const TICK_MS = 5000
const IDLE_MS = 5 * 60_000

/**
 * Tells main where the reader is:
 * - library.setLastPage (debounced) so the book reopens here,
 * - index.focus once the page settles, so indexing jumps to this chunk,
 * - reading.track: seconds per page, flushed every ~15 s and on page change; paused while the
 *   window is hidden or after 5 minutes without input.
 */
export function useReaderReporting(docId: string, page: number | null): void {
  const { mutate: setLastPage } = useSetLastPage()
  const { mutate: focus } = useIndexFocus()
  const { mutate: track } = useTrackReading()
  const tracker = useRef<ReadingTracker | null>(null)
  const pageRef = useRef(page)

  useEffect(() => {
    const t = new ReadingTracker((entry) => track({ docId, ...entry }))
    tracker.current = t
    if (pageRef.current !== null) t.setPage(pageRef.current, Date.now())
    let lastInput = Date.now()
    const visible = (): boolean => document.visibilityState !== 'hidden'
    if (visible()) t.resume(Date.now())

    const onVisibility = (): void => (visible() ? t.resume(Date.now()) : t.pause(Date.now()))
    const onInput = (): void => {
      lastInput = Date.now()
      if (visible()) t.resume(lastInput)
    }
    const interval = window.setInterval(() => {
      const now = Date.now()
      if (now - lastInput > IDLE_MS) t.pause(now)
      else t.tick(now)
    }, TICK_MS)

    document.addEventListener('visibilitychange', onVisibility)
    const inputs = ['pointermove', 'keydown', 'wheel'] as const
    for (const ev of inputs) window.addEventListener(ev, onInput, { passive: true })
    return () => {
      window.clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisibility)
      for (const ev of inputs) window.removeEventListener(ev, onInput)
      t.stop(Date.now())
      tracker.current = null
    }
  }, [docId, track])

  useEffect(() => {
    pageRef.current = page
    if (page === null) return
    const t1 = window.setTimeout(() => setLastPage({ docId, page }), LAST_PAGE_DEBOUNCE_MS)
    const t2 = window.setTimeout(() => focus({ docId, page }), FOCUS_SETTLE_MS)
    tracker.current?.setPage(page, Date.now())
    return () => {
      window.clearTimeout(t1)
      window.clearTimeout(t2)
    }
  }, [docId, page, setLastPage, focus])
}
