import { and, desc, eq } from 'drizzle-orm'
import type { RepoContext } from '../context'
import { portalWatches } from '../schema'
import type { PortalWatchRepo } from '../types'

/** Persist watch baselines independently of the foreground portal browser. */
export function createPortalWatchRepo(ctx: RepoContext): PortalWatchRepo {
  const { db } = ctx
  return {
    list: () => db.select().from(portalWatches).orderBy(desc(portalWatches.createdAt)).all(),
    get: (id) => db.select().from(portalWatches).where(eq(portalWatches.id, id)).get() ?? null,
    create(input, now) {
      return ctx.tx(() => {
        const existing = db
          .select()
          .from(portalWatches)
          .where(and(eq(portalWatches.courseId, input.courseId), eq(portalWatches.url, input.url)))
          .get()
        if (existing) return existing
        return db
          .insert(portalWatches)
          .values({ ...input, id: ctx.newId(), createdAt: now })
          .returning()
          .get()
      })
    },
    checked(id, title, seenLinks, now) {
      db.update(portalWatches).set({ title, seenLinks, checkedAt: now }).where(eq(portalWatches.id, id)).run()
    },
    remove(id) {
      db.delete(portalWatches).where(eq(portalWatches.id, id)).run()
    }
  }
}
