import { basename, dirname } from 'node:path'
import type { CourseId, DocId } from '@shared/domain'
import type { Database } from '../db/types'
import { notFound } from './errors'
import { requireDoc } from './scope'
import type { Handlers, PipelineDeps } from './types'

type CourseChannels =
  | 'courses.list'
  | 'courses.create'
  | 'courses.rename'
  | 'courses.dissolve'
  | 'courses.moveDocument'
  | 'courses.reorder'

/** Folder names that say nothing about the subject. */
const GENERIC_FOLDERS = new Set([
  'downloads',
  'download',
  'desktop',
  'documents',
  'docs',
  'tmp',
  'temp',
  'home'
])

/**
 * A name for a course made from files imported together: their shared folder ("…/Optical Networks/
 * week3.pptx" → "Optical Networks") unless it is generic, else the first file's title.
 */
export function courseNameFor(paths: readonly string[], firstTitle: string): string {
  const folders = new Set(paths.map((p) => dirname(p)))
  const [only] = folders
  const folder = folders.size === 1 && only !== undefined ? basename(only) : ''
  return folder && !GENERIC_FOLDERS.has(folder.toLowerCase()) ? folder : firstTitle
}

export function requireCourse(db: Database, courseId: CourseId): CourseId {
  if (!db.courses.get(courseId)) throw notFound('Course', courseId)
  return courseId
}

/**
 * Where imported files go: into `courseId` when given; otherwise several new files form one new course
 * and a single file gets its own. Files that were already in the library keep their course.
 */
export function placeImported(
  db: Database,
  imported: readonly { id: DocId; created: boolean }[],
  opts: { courseId: CourseId | null; paths: readonly string[]; now: string }
): void {
  const ids = [...new Set(imported.map((d) => d.id))]
  if (opts.courseId !== null) {
    requireCourse(db, opts.courseId)
    for (const id of ids) db.courses.moveDocument(id, opts.courseId, Number.MAX_SAFE_INTEGER)
    return
  }
  const fresh = ids.filter((id) => imported.some((d) => d.id === id && d.created))
  const first = fresh[0]
  if (fresh.length > 1 && first !== undefined) {
    db.courses.create(courseNameFor(opts.paths, requireDoc(db, first).title), fresh, opts.now)
  }
  for (const id of ids) db.courses.ensureCourse(id, opts.now)
}

/** Courses: group, order and rename files. Changes are announced as library changes. */
export function createCourses(deps: Pick<PipelineDeps, 'db' | 'emit' | 'now'>): {
  handlers: Pick<Handlers, CourseChannels>
} {
  const { db } = deps
  const nowIso = (): string => deps.now().toISOString()
  const changed = (): void => deps.emit('library.changed', { docId: null })

  return {
    handlers: {
      'courses.list': async () => db.courses.list(),

      'courses.create': async ({ name, docIds }) => {
        for (const id of docIds) requireDoc(db, id)
        const course = db.courses.create(name, docIds, nowIso())
        changed()
        return course
      },

      'courses.rename': async ({ courseId, name }) => {
        requireCourse(db, courseId)
        db.courses.rename(courseId, name)
        changed()
        return db.courses.get(courseId) ?? { id: courseId, name, docIds: [] }
      },

      'courses.dissolve': async ({ courseId }) => {
        requireCourse(db, courseId)
        db.courses.dissolve(courseId, nowIso())
        changed()
        return { ok: true }
      },

      'courses.moveDocument': async ({ docId, courseId, index }) => {
        requireDoc(db, docId)
        requireCourse(db, courseId)
        db.courses.moveDocument(docId, courseId, index)
        changed()
        return db.courses.list()
      },

      'courses.reorder': async ({ courseIds }) => {
        db.courses.reorder(courseIds)
        changed()
        return db.courses.list()
      }
    }
  }
}
