import type { Course } from '@shared/domain'
import { dropMove, edgeAt, groupByCourse, nudgeFile } from './tree'

const courses: Course[] = [
  { id: 'optics', name: 'Optics', docIds: ['w1', 'w2', 'w3'], portalUrl: null },
  { id: 'radio', name: 'Radio', docIds: ['r1'], portalUrl: null }
]

describe('course tree drops', () => {
  it('reorders a file within its course', () => {
    expect(
      dropMove(courses, { kind: 'file', docId: 'w1' }, { kind: 'file', docId: 'w3', edge: 'after' })
    ).toEqual({ type: 'moveFile', docId: 'w1', courseId: 'optics', index: 2 })
    expect(
      dropMove(courses, { kind: 'file', docId: 'w3' }, { kind: 'file', docId: 'w1', edge: 'before' })
    ).toEqual({ type: 'moveFile', docId: 'w3', courseId: 'optics', index: 0 })
    // Dropping right where it is changes nothing.
    expect(
      dropMove(courses, { kind: 'file', docId: 'w2' }, { kind: 'file', docId: 'w1', edge: 'after' })
    ).toBeNull()
    expect(
      dropMove(courses, { kind: 'file', docId: 'w2' }, { kind: 'file', docId: 'w2', edge: 'before' })
    ).toBeNull()
  })

  it('moves a file into another course, at a row or at the end', () => {
    expect(
      dropMove(courses, { kind: 'file', docId: 'w2' }, { kind: 'file', docId: 'r1', edge: 'before' })
    ).toEqual({ type: 'moveFile', docId: 'w2', courseId: 'radio', index: 0 })
    expect(
      dropMove(courses, { kind: 'file', docId: 'w2' }, { kind: 'course', courseId: 'radio', edge: 'inside' })
    ).toEqual({ type: 'moveFile', docId: 'w2', courseId: 'radio', index: 1 })
    expect(
      dropMove(courses, { kind: 'file', docId: 'w2' }, { kind: 'course', courseId: 'optics', edge: 'inside' })
    ).toBeNull()
  })

  it('reorders courses', () => {
    expect(
      dropMove(
        courses,
        { kind: 'course', courseId: 'radio' },
        { kind: 'course', courseId: 'optics', edge: 'before' }
      )
    ).toEqual({ type: 'reorder', courseIds: ['radio', 'optics'] })
    expect(
      dropMove(
        courses,
        { kind: 'course', courseId: 'radio' },
        { kind: 'course', courseId: 'optics', edge: 'after' }
      )
    ).toBeNull()
    expect(
      dropMove(courses, { kind: 'course', courseId: 'radio' }, { kind: 'file', docId: 'w1', edge: 'after' })
    ).toBeNull()
  })

  it('nudges files up and down within bounds', () => {
    expect(nudgeFile(courses, 'w2', -1)).toEqual({
      type: 'moveFile',
      docId: 'w2',
      courseId: 'optics',
      index: 0
    })
    expect(nudgeFile(courses, 'w3', 1)).toBeNull()
    expect(nudgeFile(courses, 'nope', 1)).toBeNull()
  })

  it('splits a row into halves', () => {
    expect(edgeAt(104, { top: 100, height: 20 })).toBe('before')
    expect(edgeAt(115, { top: 100, height: 20 })).toBe('after')
  })
})

describe('groupByCourse', () => {
  it('gives multi-file courses a section and keeps the rest in library order', () => {
    const docs = [{ id: 'r1' }, { id: 'w2' }, { id: 'solo' }, { id: 'w1' }]
    const result = groupByCourse(docs, [
      { id: 'optics', name: 'Optics', docIds: ['w1', 'w2'], portalUrl: null },
      { id: 'radio', name: 'Radio', docIds: ['r1'], portalUrl: null }
    ])
    expect(result.courses.map((g) => [g.course.id, g.docs.map((d) => d.id)])).toEqual([
      ['optics', ['w1', 'w2']]
    ])
    expect(result.singles.map((d) => d.id)).toEqual(['r1', 'solo'])
  })
})
