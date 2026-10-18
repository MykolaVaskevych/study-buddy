import { eq } from 'drizzle-orm'
import { iso, type RepoContext } from '../context'
import { examProfiles } from '../schema'
import type { ExamProfileRepo } from '../types'

export function createExamProfileRepo(ctx: RepoContext): ExamProfileRepo {
  const { db } = ctx
  return {
    get(docId) {
      const row = db.select().from(examProfiles).where(eq(examProfiles.docId, docId)).get()
      return row ? { docId, ...row.profile, updatedAt: row.updatedAt } : null
    },
    save(profile, now) {
      const updatedAt = iso(now)
      const { docId, updatedAt: _ignored, ...rest } = profile
      const value = { ...rest, source: profile.source === 'past_paper' ? 'past_paper' : 'user' } as const
      db.insert(examProfiles)
        .values({ docId, profile: value, updatedAt })
        .onConflictDoUpdate({ target: examProfiles.docId, set: { profile: value, updatedAt } })
        .run()
      return { docId, ...value, updatedAt }
    }
  }
}
