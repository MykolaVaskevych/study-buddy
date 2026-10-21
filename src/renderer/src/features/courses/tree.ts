import type { Course } from '@shared/domain'

/** What is being dragged in the course tree. */
export type DragItem = { kind: 'file'; docId: string } | { kind: 'course'; courseId: string }

/** Where it is dropped: before/after a row, or into a course. */
export type DropTarget =
  | { kind: 'file'; docId: string; edge: 'before' | 'after' }
  | { kind: 'course'; courseId: string; edge: 'before' | 'after' | 'inside' }

export type TreeMove =
  | { type: 'moveFile'; docId: string; courseId: string; index: number }
  | { type: 'reorder'; courseIds: string[] }

const courseOf = (courses: readonly Course[], docId: string): Course | undefined =>
  courses.find((c) => c.docIds.includes(docId))

/**
 * The change a drop makes, or null when it changes nothing. File indexes are positions in the
 * target course without the moved file (that is how courses.moveDocument inserts).
 */
export function dropMove(courses: readonly Course[], item: DragItem, target: DropTarget): TreeMove | null {
  if (item.kind === 'file') {
    const from = courseOf(courses, item.docId)
    if (target.kind === 'course') {
      const to = courses.find((c) => c.id === target.courseId)
      if (!to || to.id === from?.id) return null
      return { type: 'moveFile', docId: item.docId, courseId: to.id, index: to.docIds.length }
    }
    if (target.docId === item.docId) return null
    const to = courseOf(courses, target.docId)
    if (!to) return null
    const rest = to.docIds.filter((id) => id !== item.docId)
    const index = rest.indexOf(target.docId) + (target.edge === 'after' ? 1 : 0)
    if (to.id === from?.id && to.docIds.indexOf(item.docId) === index) return null
    return { type: 'moveFile', docId: item.docId, courseId: to.id, index }
  }
  if (target.kind !== 'course' || target.edge === 'inside' || target.courseId === item.courseId) return null
  const ids = courses.map((c) => c.id)
  const rest = ids.filter((id) => id !== item.courseId)
  const at = rest.indexOf(target.courseId) + (target.edge === 'after' ? 1 : 0)
  const order = [...rest.slice(0, at), item.courseId, ...rest.slice(at)]
  return order.every((id, i) => id === ids[i]) ? null : { type: 'reorder', courseIds: order }
}

/** Keyboard and menu equivalent of dragging a file one row up or down within its course. */
export function nudgeFile(courses: readonly Course[], docId: string, delta: -1 | 1): TreeMove | null {
  const course = courseOf(courses, docId)
  if (!course) return null
  const index = course.docIds.indexOf(docId) + delta
  if (index < 0 || index >= course.docIds.length) return null
  return { type: 'moveFile', docId, courseId: course.id, index }
}

/** Upper half of a row drops before it, lower half after. */
export const edgeAt = (clientY: number, rect: { top: number; height: number }): 'before' | 'after' =>
  clientY < rect.top + rect.height / 2 ? 'before' : 'after'

/**
 * The library's layout: courses with two or more files get their own section (files in course
 * order); everything else stays in one grid in the library's order.
 */
export function groupByCourse<D extends { id: string }>(
  docs: readonly D[],
  courses: readonly Course[]
): { courses: { course: Course; docs: D[] }[]; singles: D[] } {
  const byId = new Map(docs.map((d) => [d.id, d]))
  const grouped = courses
    .filter((c) => c.docIds.length > 1)
    .map((course) => ({ course, docs: course.docIds.flatMap((id) => byId.get(id) ?? []) }))
    .filter((g) => g.docs.length > 0)
  const inGroup = new Set(grouped.flatMap((g) => g.docs.map((d) => d.id)))
  return { courses: grouped, singles: docs.filter((d) => !inGroup.has(d.id)) }
}
