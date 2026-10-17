import type { PageChecks } from './page-checks'
import { requireDoc, requirePage } from './scope'
import type { Handlers, PipelineDeps } from './types'

/**
 * Reading time. Stored per page; topic `minutesSpent` (planner) and the reading-speed calibration
 * of estimates are computed from it by the repositories. Crossing the prefetch threshold on a page
 * starts its page check in the background.
 */
export function createReading(
  deps: Pick<PipelineDeps, 'db' | 'now'>,
  services: { pageChecks: PageChecks }
): { handlers: Pick<Handlers, 'reading.track'> } {
  const { db } = deps
  return {
    handlers: {
      'reading.track': async ({ docId, page, seconds }) => {
        requirePage(requireDoc(db, docId), page)
        const before = db.reading.secondsOnPage(docId, page)
        db.reading.track(docId, page, seconds, deps.now().toISOString())
        services.pageChecks.maybePrefetch(docId, page, before, db.reading.secondsOnPage(docId, page))
        return { ok: true }
      }
    }
  }
}
