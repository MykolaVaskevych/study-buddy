import { and, asc, eq } from 'drizzle-orm'
import type { Annotation } from '@shared/domain'
import { iso, type RepoContext } from '../context'
import { annotations } from '../schema'
import type { AnnotationRepo } from '../types'

type Row = typeof annotations.$inferSelect

const toAnnotation = (r: Row): Annotation => ({
  id: r.id,
  docId: r.docId,
  page: r.page,
  kind: r.kind,
  text: r.text,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt
})

export function createAnnotationRepo(ctx: RepoContext): AnnotationRepo {
  const { db } = ctx
  return {
    list(docId) {
      return db
        .select()
        .from(annotations)
        .where(eq(annotations.docId, docId))
        .orderBy(asc(annotations.page), asc(annotations.kind))
        .all()
        .map(toAnnotation)
    },

    upsert({ docId, page, kind, text }, now) {
      const at = iso(now)
      const row = db
        .insert(annotations)
        .values({ id: ctx.newId(), docId, page, kind, text, createdAt: at, updatedAt: at })
        .onConflictDoUpdate({
          target: [annotations.docId, annotations.page, annotations.kind],
          set: { text, updatedAt: at }
        })
        .returning()
        .get()
      return toAnnotation(row)
    },

    remove(docId, page, kind) {
      db.delete(annotations)
        .where(and(eq(annotations.docId, docId), eq(annotations.page, page), eq(annotations.kind, kind)))
        .run()
    }
  }
}
