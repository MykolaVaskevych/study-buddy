import { asc, eq, sql } from 'drizzle-orm'
import type { Course, CourseId, DocId } from '@shared/domain'
import { NotFoundError, type RepoContext } from '../context'
import { courses, documents } from '../schema'
import type { CourseRepo } from '../types'

/**
 * Courses group files. Every write ends by dropping courses left without files, so the sidebar never
 * shows an empty course and moving the last file out of a course removes it.
 */
export function createCourseRepo(ctx: RepoContext): CourseRepo {
  const { db } = ctx

  const filesOf = (courseId: CourseId): DocId[] =>
    db
      .select({ id: documents.id })
      .from(documents)
      .where(eq(documents.courseId, courseId))
      .orderBy(asc(documents.ord), asc(documents.importedAt))
      .all()
      .map((r) => r.id)

  const setFiles = (courseId: CourseId, docIds: readonly DocId[]): void => {
    docIds.forEach((id, ord) => db.update(documents).set({ courseId, ord }).where(eq(documents.id, id)).run())
  }

  // Literal `courses.id`: drizzle renders the column unqualified here, which would bind to `d.id`.
  const prune = (): void => {
    db.delete(courses)
      .where(sql`not exists (select 1 from documents d where d.course_id = courses.id)`)
      .run()
  }

  const insert = (name: string, now: string): CourseId => {
    const max =
      db
        .select({ ord: sql<number | null>`max(${courses.ord})` })
        .from(courses)
        .get()?.ord ?? -1
    const id = ctx.newId()
    db.insert(courses)
      .values({ id, name, ord: max + 1, createdAt: now })
      .run()
    return id
  }

  const get = (courseId: CourseId): Course | null => {
    const row = db.select().from(courses).where(eq(courses.id, courseId)).get()
    return row ? { id: row.id, name: row.name, docIds: filesOf(row.id) } : null
  }

  const courseOf = (docId: DocId): CourseId | null =>
    db.select({ courseId: documents.courseId }).from(documents).where(eq(documents.id, docId)).get()
      ?.courseId ?? null

  return {
    list() {
      const rows = db.select().from(courses).orderBy(asc(courses.ord), asc(courses.createdAt)).all()
      const files = new Map<CourseId, DocId[]>()
      for (const d of db
        .select({ id: documents.id, courseId: documents.courseId })
        .from(documents)
        .orderBy(asc(documents.ord), asc(documents.importedAt))
        .all()) {
        if (d.courseId !== null) files.set(d.courseId, [...(files.get(d.courseId) ?? []), d.id])
      }
      return rows.flatMap((r) => {
        const docIds = files.get(r.id) ?? []
        return docIds.length > 0 ? [{ id: r.id, name: r.name, docIds }] : []
      })
    },

    get,

    create(name, docIds, now) {
      return ctx.tx(() => {
        const sources = new Set(docIds.map(courseOf))
        const id = insert(name, now)
        setFiles(id, docIds)
        for (const source of sources) if (source !== null) setFiles(source, filesOf(source))
        prune()
        return get(id) ?? { id, name, docIds: [] }
      })
    },

    rename(courseId, name) {
      db.update(courses).set({ name }).where(eq(courses.id, courseId)).run()
    },

    dissolve(courseId, now) {
      ctx.tx(() => {
        const docs = db
          .select({ id: documents.id, title: documents.title })
          .from(documents)
          .where(eq(documents.courseId, courseId))
          .orderBy(asc(documents.ord), asc(documents.importedAt))
          .all()
        for (const d of docs) setFiles(insert(d.title, now), [d.id])
        prune()
      })
    },

    moveDocument(docId, courseId, index) {
      ctx.tx(() => {
        const source = courseOf(docId)
        const files = filesOf(courseId).filter((id) => id !== docId)
        files.splice(Math.max(0, Math.min(index, files.length)), 0, docId)
        setFiles(courseId, files)
        if (source !== null && source !== courseId) setFiles(source, filesOf(source))
        prune()
      })
    },

    reorder(courseIds) {
      ctx.tx(() => {
        const listed = new Set(courseIds)
        const rest = db
          .select({ id: courses.id })
          .from(courses)
          .orderBy(asc(courses.ord), asc(courses.createdAt))
          .all()
          .map((r) => r.id)
          .filter((id) => !listed.has(id))
        ;[...courseIds, ...rest].forEach((id, ord) =>
          db.update(courses).set({ ord }).where(eq(courses.id, id)).run()
        )
      })
    },

    ensureCourse(docId, now) {
      return ctx.tx(() => {
        const doc = db
          .select({ courseId: documents.courseId, title: documents.title })
          .from(documents)
          .where(eq(documents.id, docId))
          .get()
        if (!doc) throw new NotFoundError('Document', docId)
        if (doc.courseId !== null && get(doc.courseId)) return doc.courseId
        const id = insert(doc.title, now)
        setFiles(id, [docId])
        return id
      })
    }
  }
}
