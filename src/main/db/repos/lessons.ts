import { and, eq } from 'drizzle-orm'
import type { Lesson } from '@shared/domain'
import { iso, type RepoContext } from '../context'
import { lessons } from '../schema'
import type { LessonRepo } from '../types'

type Row = typeof lessons.$inferSelect

const toLesson = (r: Row): Lesson => ({
  docId: r.docId,
  topicId: r.topicId,
  sections: r.sections,
  exercises: r.exercises,
  createdAt: r.createdAt
})

export function createLessonRepo(ctx: RepoContext): LessonRepo {
  const { db } = ctx
  return {
    list(docId) {
      return db.select().from(lessons).where(eq(lessons.docId, docId)).all().map(toLesson)
    },
    get(docId, topicId) {
      const row = db
        .select()
        .from(lessons)
        .where(and(eq(lessons.docId, docId), eq(lessons.topicId, topicId)))
        .get()
      return row ? toLesson(row) : null
    },
    save(lesson, now) {
      const createdAt = iso(now)
      const values = { ...lesson, createdAt }
      db.insert(lessons)
        .values(values)
        .onConflictDoUpdate({ target: [lessons.docId, lessons.topicId], set: values })
        .run()
      return { ...lesson, createdAt }
    }
  }
}
