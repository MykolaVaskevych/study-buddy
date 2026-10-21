import { copyFile, mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { createHarness, type Harness } from './test-harness'

const bounds = { x: 0, y: 40, width: 800, height: 600 }

describe('portal', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('opens the course portal page, remembers where the student went and imports downloads there', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const [course] = await harness.h['courses.list']({})
    if (!course) throw new Error('no course')

    const opened = await harness.h['portal.open']({ bounds, courseId: course.id })
    expect(opened).toMatchObject({ url: null, courseId: course.id })
    expect(harness.portal.visible()).toBe(true)

    await harness.h['portal.navigate']({ url: 'sulis.ul.ie/portal/site/CS4337' })
    expect((await harness.h['courses.list']({}))[0]?.portalUrl).toBe('https://sulis.ul.ie/portal/site/CS4337')
    expect(harness.eventsOf('portal.changed').at(-1)).toMatchObject({
      url: 'https://sulis.ul.ie/portal/site/CS4337'
    })
    await expect(harness.h['portal.navigate']({ url: 'file:///etc/passwd' })).rejects.toMatchObject({
      kind: 'validation'
    })

    // A download of a study file lands in the course (the fixture stands in for "Week 5.pdf").
    const dir = join(harness.libraryDir, '..', 'dl', '1')
    await mkdir(dir, { recursive: true })
    const path = join(dir, 'Week 5.pdf')
    await copyFile(harness.fixture, path)
    harness.portal.download({
      path,
      fileName: 'Week 5.pdf',
      url: 'https://sulis.ul.ie/access/content/week5.pdf'
    })
    await vi.waitFor(() => expect(harness.eventsOf('portal.downloaded')).toHaveLength(1))
    expect(harness.eventsOf('portal.downloaded')[0]).toMatchObject({
      fileName: 'Week 5.pdf',
      courseId: course.id,
      error: null
    })
    // Same bytes as the fixture: already in the library, kept in its course; the temp file is gone.
    expect(harness.eventsOf('portal.downloaded')[0]?.docIds).toEqual([docId])
    await expect(stat(path)).rejects.toThrow()

    await harness.h['portal.close']({})
    expect(harness.portal.visible()).toBe(false)
  })

  it('opens where the course left off', async () => {
    harness = await createHarness()
    await harness.importIndexed()
    const [course] = await harness.h['courses.list']({})
    if (!course) throw new Error('no course')
    harness.db.courses.setPortalUrl(course.id, 'https://learn.ul.ie/d2l/home/123')
    const state = await harness.h['portal.open']({ bounds, courseId: course.id })
    expect(state.url).toBe('https://learn.ul.ie/d2l/home/123')
  })
})
