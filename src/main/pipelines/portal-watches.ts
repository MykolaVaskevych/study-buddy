import { fileLinks, isWatchPage, newFileLinks } from '../portal/watch-links'
import type { PipelineDeps, PortalScheduler } from './types'

export const WATCH_START_MS = 60_000
export const WATCH_INTERVAL_MS = 6 * 60 * 60_000

const scheduleTimer: PortalScheduler = (task, delayMs) => {
  const timer = setTimeout(task, delayMs)
  timer.unref()
  return () => clearTimeout(timer)
}

/** Sequential, cancellable checks keep a slow portal from overlapping the next round. */
export function createPortalWatchChecker(
  deps: Pick<PipelineDeps, 'db' | 'portal' | 'emit' | 'now' | 'portalScheduler'>
): { start(): void; stop(): Promise<void> } {
  const schedule = deps.portalScheduler ?? scheduleTimer
  let stopped = true
  let cancel: (() => void) | null = null
  let running: Promise<void> | null = null

  const check = async (): Promise<void> => {
    for (const watch of deps.db.portalWatches.list()) {
      if (stopped) return
      try {
        const page = await deps.portal.readPage(watch.url)
        // Unwatch and course deletion can happen while the hidden page is loading.
        if (stopped) return
        if (!page || !isWatchPage(page, watch.url) || !deps.db.portalWatches.get(watch.id)) continue
        const links = fileLinks(page)
        const items = newFileLinks(links, watch.seenLinks)
        // Remember earlier links too: temporary omissions must not re-announce old files.
        const seenLinks = [...new Set([...watch.seenLinks, ...links.map((link) => link.href)])]
        deps.db.portalWatches.checked(watch.id, page.title, seenLinks, deps.now().toISOString())
        if (watch.checkedAt !== null && items.length > 0) {
          deps.emit('portal.newFiles', {
            watchId: watch.id,
            courseId: watch.courseId,
            url: watch.url,
            title: page.title,
            items
          })
        }
      } catch {
        // Expired sessions and network errors are retried on the next round, leaving the baseline intact.
      }
    }
  }
  const tick = (): void => {
    if (stopped) return
    running = check().finally(() => {
      running = null
      if (!stopped) cancel = schedule(tick, WATCH_INTERVAL_MS)
    })
  }
  return {
    start() {
      if (!stopped) return
      stopped = false
      cancel = schedule(tick, WATCH_START_MS)
    },
    async stop() {
      stopped = true
      cancel?.()
      cancel = null
      await running
    }
  }
}
