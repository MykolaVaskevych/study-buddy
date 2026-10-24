import type { PageSnapshot } from '../portal/snapshot'
import { seedDocument } from '../db/test-helpers'
import { createHarness, type Harness, START } from './test-harness'
import { WATCH_INTERVAL_MS, WATCH_START_MS } from './portal-watches'
import type { PortalScheduler } from './types'

const url = 'https://portal.edu/course'
const page = (names: string[], address = url): PageSnapshot => ({
  url: address,
  title: 'Lectures',
  headings: [],
  text: '',
  elements: names.map((name, id) => ({
    id,
    kind: 'link',
    label: name,
    href: `https://portal.edu/${name}`,
    expanded: null
  }))
})

function scheduler() {
  let next: (() => void) | null = null
  const delays: number[] = []
  const schedule: PortalScheduler = (task, ms) => {
    next = task
    delays.push(ms)
    return () => {
      next = null
    }
  }
  return {
    schedule,
    delays,
    pending: () => next !== null,
    fire() {
      const task = next
      next = null
      task?.()
    }
  }
}

describe('portal watches', () => {
  let harness: Harness
  afterEach(async () => harness?.close())

  async function setup() {
    const timer = scheduler()
    harness = await createHarness({ portalScheduler: timer.schedule })
    const courseId = harness.db.courses.ensureCourse(seedDocument(harness.db), START)
    const watch = await harness.h['portal.watch']({ courseId, url })
    return { timer, courseId, watch }
  }

  it('schedules a quiet baseline, then reports only new links and stops cleanly', async () => {
    const { timer, courseId, watch } = await setup()
    const click = vi.spyOn(harness.portal, 'click')
    const navigate = vi.spyOn(harness.portal, 'navigate')
    harness.portal.readWith(async () => page(['a.pdf']))
    expect(timer.delays).toEqual([WATCH_START_MS])
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(2))
    expect(timer.delays[1]).toBe(WATCH_INTERVAL_MS)
    expect(harness.eventsOf('portal.newFiles')).toEqual([])
    expect(harness.db.portalWatches.get(watch.id)).toMatchObject({
      title: 'Lectures',
      checkedAt: START,
      seenLinks: ['https://portal.edu/a.pdf']
    })
    harness.clock.advance(WATCH_INTERVAL_MS)
    harness.portal.readWith(async () => page(['a.pdf', 'b.pptx']))
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(3))
    expect(harness.eventsOf('portal.newFiles')).toEqual([
      {
        watchId: watch.id,
        courseId,
        url,
        title: 'Lectures',
        items: [{ label: 'b.pptx', href: 'https://portal.edu/b.pptx' }]
      }
    ])
    harness.portal.readWith(async () => page([]))
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(4))
    harness.portal.readWith(async () => page(['a.pdf', 'b.pptx']))
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(5))
    expect(harness.eventsOf('portal.newFiles')).toHaveLength(1)
    expect(click).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    await harness.pipelines.stop()
    expect(timer.pending()).toBe(false)
  })

  it('skips failures and sign-in pages, checks other watches, and retries without resetting baselines', async () => {
    const { timer, courseId, watch } = await setup()
    const otherUrl = 'https://portal.edu/other'
    const other = await harness.h['portal.watch']({ courseId, url: otherUrl })
    harness.portal.readWith(async (address) => {
      if (address === url) throw new Error('network')
      return page([], address)
    })
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(2))
    expect(harness.db.portalWatches.get(watch.id)?.checkedAt).toBeNull()
    expect(harness.db.portalWatches.get(other.id)?.checkedAt).toBe(START)
    harness.portal.readWith(async () => page([], 'https://sso.edu/login'))
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(3))
    expect(harness.db.portalWatches.get(watch.id)?.checkedAt).toBeNull()
    harness.portal.readWith(async (address) => page(['a.pdf'], address))
    timer.fire()
    await vi.waitFor(() => expect(timer.delays).toHaveLength(4))
    expect(harness.eventsOf('portal.newFiles').map((event) => event.watchId)).toEqual([other.id])
    expect(harness.db.portalWatches.get(watch.id)?.seenLinks).toEqual(['https://portal.edu/a.pdf'])
  })

  it('does not save or emit results after unwatch or shutdown during a read', async () => {
    const { timer, courseId, watch } = await setup()
    let finish: (value: PageSnapshot | null) => void = () => undefined
    harness.portal.readWith(
      () =>
        new Promise((resolve) => {
          finish = resolve
        })
    )
    timer.fire()
    expect(timer.pending()).toBe(false)
    await harness.h['portal.unwatch']({ watchId: watch.id })
    finish(page(['a.pdf']))
    await vi.waitFor(() => expect(timer.delays).toHaveLength(2))
    expect(await harness.h['portal.watches']({})).toEqual([])
    const again = await harness.h['portal.watch']({ courseId, url })
    timer.fire()
    const stopping = harness.pipelines.stop()
    finish(page(['a.pdf']))
    await stopping
    expect(harness.db.portalWatches.get(again.id)?.checkedAt).toBeNull()
    expect(harness.eventsOf('portal.newFiles')).toEqual([])
    expect(timer.pending()).toBe(false)
  })

  it('validates courses and URLs and preserves the baseline for repeated watch requests', async () => {
    const { courseId, watch } = await setup()
    await expect(harness.h['portal.watch']({ courseId: 'missing', url })).rejects.toMatchObject({
      kind: 'not_found'
    })
    await expect(harness.h['portal.watch']({ courseId, url: 'file:///etc/passwd' })).rejects.toMatchObject({
      kind: 'validation'
    })
    expect(await harness.h['portal.watch']({ courseId, url })).toEqual(watch)
    expect(await harness.h['portal.watches']({})).toHaveLength(1)
  })
})
