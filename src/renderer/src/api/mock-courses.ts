import type { Course } from '@shared/domain'
import type { IpcInput, IpcOutput } from '@shared/ipc/contract'

type CourseChannel =
  | 'courses.list'
  | 'courses.create'
  | 'courses.rename'
  | 'courses.dissolve'
  | 'courses.moveDocument'
  | 'courses.reorder'

export interface MockCourses {
  handlers: { [C in CourseChannel]: (input: IpcInput<C>) => IpcOutput<C> }
  /** Imported files: into `courseId`, else several new ones share a new course, one gets its own. */
  place(docIds: string[], courseId: string | null, name: string): void
  removeDoc(docId: string): void
}

/** Courses for the mock api, same rules as the main process: no empty courses survive a change. */
export function createMockCourses(
  books: { id: string; title: string }[],
  deps: {
    nextId: (prefix: string) => string
    titleOf: (docId: string) => string
    fail: (message: string) => never
  }
): MockCourses {
  let courses: Course[] = books.map((b) => ({ id: `course-${b.id}`, name: b.title, docIds: [b.id] }))
  const prune = (): void => {
    courses = courses.filter((c) => c.docIds.length > 0)
  }
  const detach = (docIds: readonly string[]): void => {
    courses = courses.map((c) => ({ ...c, docIds: c.docIds.filter((id) => !docIds.includes(id)) }))
  }
  const find = (courseId: string): Course =>
    courses.find((c) => c.id === courseId) ?? deps.fail(`Course not found: ${courseId}`)
  const create = (name: string, docIds: string[]): Course => {
    detach(docIds)
    const course = { id: deps.nextId('course'), name, docIds: [...docIds] }
    courses = [...courses, course]
    prune()
    return course
  }
  const list = (): Course[] => courses.map((c) => ({ ...c, docIds: [...c.docIds] }))

  return {
    handlers: {
      'courses.list': () => list(),
      'courses.create': ({ name, docIds }) => create(name, docIds),
      'courses.rename': ({ courseId, name }) => {
        find(courseId).name = name
        return { ...find(courseId) }
      },
      'courses.dissolve': ({ courseId }) => {
        for (const id of [...find(courseId).docIds]) create(deps.titleOf(id), [id])
        return { ok: true }
      },
      'courses.moveDocument': ({ docId, courseId, index }) => {
        const target = find(courseId)
        detach([docId])
        target.docIds.splice(Math.min(index, target.docIds.length), 0, docId)
        prune()
        return list()
      },
      'courses.reorder': ({ courseIds }) => {
        const rank = (c: Course): number => {
          const i = courseIds.indexOf(c.id)
          return i < 0 ? courseIds.length : i
        }
        courses = courses
          .map((c, i) => ({ c, i }))
          .sort((a, b) => rank(a.c) - rank(b.c) || a.i - b.i)
          .map((x) => x.c)
        return list()
      }
    },
    place(docIds, courseId, name) {
      const fresh = docIds.filter((id) => !courses.some((c) => c.docIds.includes(id)))
      if (courseId !== null) {
        detach(docIds)
        find(courseId).docIds.push(...docIds)
        prune()
      } else if (fresh.length > 1) create(name, fresh)
      else for (const id of fresh) create(deps.titleOf(id), [id])
    },
    removeDoc(docId) {
      detach([docId])
      prune()
    }
  }
}
