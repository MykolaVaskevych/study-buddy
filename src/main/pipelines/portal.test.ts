import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import type { PortalStepOutput } from '@shared/ai/schemas'
import { createFakeProvider } from '../ai/providers/fake/provider'
import type { PageSnapshot } from '../portal/snapshot'
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
      kind: 'import',
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

    // Other files are kept in Downloads, and the screen is told why they were not imported.
    harness.portal.download({
      kind: 'saved',
      path: '/home/u/Downloads/all.zip',
      fileName: 'all.zip',
      url: 'https://x/all.zip'
    })
    expect(harness.eventsOf('portal.downloaded').at(-1)).toMatchObject({
      fileName: 'all.zip',
      docIds: [],
      error: /Downloads/
    })

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

describe('Get files with AI', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('expands, opens a topic, refuses a dangerous button, downloads, and files land in one course', async () => {
    const steps: PortalStepOutput[] = [
      {
        thought: 'Week 5 is collapsed.',
        actions: [{ type: 'click', element: 0, why: 'expand' }],
        done: false,
        summary: ''
      },
      {
        thought: 'Open the lecture.',
        actions: [{ type: 'click', element: 1, why: 'open topic' }],
        done: false,
        summary: ''
      },
      {
        thought: 'Download it.',
        actions: [
          { type: 'click', element: 1, why: 'oops' },
          { type: 'click', element: 0, why: 'download' }
        ],
        done: false,
        summary: ''
      },
      { thought: 'All done.', actions: [], done: true, summary: 'Downloaded the week 5 lecture.' }
    ]
    const fake = createFakeProvider()
    const provider: LlmProvider = {
      ...fake,
      async generate<T>(req: GenerateRequest<T>) {
        if (req.task !== 'portal') return fake.generate(req)
        const data = steps.shift() ?? { thought: '', actions: [], done: true, summary: 'out of script' }
        return { data: data as T, usage: (await fake.generate(req)).usage, model: 'fake' }
      }
    }
    harness = await createHarness({ provider })
    const before = (await harness.h['library.list']({})).length
    // A Brightspace-like site: a content page with a collapsed week, then a topic page.
    const content = 'https://learn.ul.ie/d2l/le/content/1/Home'
    const topic = 'https://learn.ul.ie/d2l/le/content/1/viewContent/9/View'
    let expanded = false
    let deleted = false
    const pdf = join(harness.libraryDir, '..', 'dl', '2', 'W5_L5.1 MapReduce.pdf')
    await mkdir(join(pdf, '..'), { recursive: true })
    await copyFile(harness.fixture, pdf)
    const snap = (url: string, elements: PageSnapshot['elements']): PageSnapshot => ({
      url,
      title: 'Scalable Computing',
      headings: [],
      text: '',
      elements
    })
    harness.portal.navigate(content)
    harness.portal.script({
      snapshot: () =>
        harness.portal.state().url === topic
          ? snap(topic, [
              { id: 0, kind: 'button', label: 'Download', href: null, expanded: null },
              { id: 1, kind: 'button', label: 'Delete topic', href: null, expanded: null }
            ])
          : snap(content, [
              { id: 0, kind: 'expander', label: 'Week 5', href: null, expanded },
              ...(expanded
                ? [{ id: 1, kind: 'link' as const, label: 'W5_L5.1 MapReduce', href: topic, expanded: null }]
                : [])
            ]),
      click: (id) => {
        const url = harness.portal.state().url
        if (url === content && id === 0) expanded = true
        else if (url === content && id === 1) harness.portal.navigate(topic)
        else if (url === topic && id === 0)
          harness.portal.download({
            kind: 'import',
            path: pdf,
            fileName: 'W5_L5.1 MapReduce.pdf',
            url: `${topic}/download`
          })
        else if (url === topic && id === 1) deleted = true
        return true
      }
    })

    expect((await harness.h['portal.agentStart']({ goal: null })).status).toBe('running')
    await vi.waitFor(() => expect(harness.eventsOf('portal.agent').at(-1)?.status).toBe('done'), {
      timeout: 5000
    })
    const final = await harness.h['portal.agentState']({})
    expect(deleted).toBe(false)
    expect(final.downloaded).toEqual(['W5_L5.1 MapReduce.pdf'])
    expect(final.log.map((l) => l.kind)).toEqual(
      expect.arrayContaining(['think', 'click', 'skip', 'file', 'done'])
    )
    expect(final.log.find((l) => l.kind === 'skip')?.text).toMatch(/Delete topic/)
    expect(final.log.at(-1)?.text).toBe('Downloaded the week 5 lecture.')
    await vi.waitFor(() => expect(harness.eventsOf('portal.downloaded')).toHaveLength(1))
    expect(harness.eventsOf('portal.downloaded')[0]).toMatchObject({
      fileName: 'W5_L5.1 MapReduce.pdf',
      error: null
    })
    expect((await harness.h['library.list']({})).length).toBe(before + 1)
  })

  it('needs an open page and can be stopped', async () => {
    harness = await createHarness()
    await expect(harness.h['portal.agentStart']({ goal: null })).rejects.toMatchObject({ kind: 'validation' })
    expect((await harness.h['portal.agentStop']({})).status).toBe('idle')
  })
})
