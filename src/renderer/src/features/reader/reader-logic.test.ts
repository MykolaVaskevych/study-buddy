import type { Topic } from '@shared/domain'
import { outputScale, pickCurrentPage } from './pdf/visibility'
import { ReadingTracker } from './readingTracker'
import type { ReadingEntry } from './readingTracker'
import { buildTopicTree, topicAt } from './topicTree'
import { effectiveZoom, fitWidthZoom, formatZoom, PDF_TO_CSS, stepZoom } from './zoom'

describe('zoom', () => {
  it('fits a 720 pt slide into the pane width minus gutters', () => {
    expect(fitWidthZoom(960 + 48, 720)).toBeCloseTo(1, 5)
    expect(fitWidthZoom(0, 720)).toBe(1)
    expect(fitWidthZoom(100000, 720)).toBe(4)
  })
  it('steps through the zoom ladder from any value', () => {
    expect(stepZoom(1, 1)).toBe(1.1)
    expect(stepZoom(1, -1)).toBe(0.9)
    expect(stepZoom(1.03, 1)).toBe(1.1)
    expect(stepZoom(4, 1)).toBe(4)
    expect(stepZoom(0.5, -1)).toBe(0.5)
  })
  it('uses the fit factor only in fit mode', () => {
    expect(effectiveZoom({ mode: 'fit' }, 1.37)).toBe(1.37)
    expect(effectiveZoom({ mode: 'scale', scale: 9 }, 1.37)).toBe(4)
    expect(formatZoom(1.25)).toBe('125%')
    expect(PDF_TO_CSS).toBeCloseTo(4 / 3)
  })
})

describe('pickCurrentPage', () => {
  it('picks the page with the most visible pixels, earlier page on ties', () => {
    expect(
      pickCurrentPage(
        new Map([
          [3, 200],
          [4, 500]
        ])
      )
    ).toBe(4)
    expect(
      pickCurrentPage(
        new Map([
          [5, 300],
          [4, 300]
        ])
      )
    ).toBe(4)
    expect(pickCurrentPage(new Map([[1, 0]]))).toBeNull()
  })
})

describe('outputScale', () => {
  it('keeps the device ratio for normal pages and caps huge canvases', () => {
    expect(outputScale(2, 960, 720)).toBe(2)
    expect(outputScale(2, 4000, 3000)).toBeLessThan(2)
  })
})

describe('ReadingTracker', () => {
  const setup = (): { t: ReadingTracker; out: ReadingEntry[] } => {
    const out: ReadingEntry[] = []
    return { t: new ReadingTracker((e) => out.push(e)), out }
  }

  it('reports time per page when the page changes', () => {
    const { t, out } = setup()
    t.resume(0)
    t.setPage(3, 0)
    t.setPage(4, 7_000)
    expect(out).toEqual([{ page: 3, seconds: 7 }])
  })

  it('flushes every 15 s on tick', () => {
    const { t, out } = setup()
    t.resume(0)
    t.setPage(9, 0)
    t.tick(10_000)
    expect(out).toEqual([])
    t.tick(16_000)
    expect(out).toEqual([{ page: 9, seconds: 16 }])
  })

  it('does not count time while paused (window hidden)', () => {
    const { t, out } = setup()
    t.resume(0)
    t.setPage(2, 0)
    t.pause(5_000)
    t.resume(65_000)
    t.setPage(3, 70_000)
    expect(out).toEqual([
      { page: 2, seconds: 5 },
      { page: 2, seconds: 5 }
    ])
  })

  it('drops slivers under a second (fast scrolling)', () => {
    const { t, out } = setup()
    t.resume(0)
    t.setPage(1, 0)
    t.setPage(2, 400)
    t.stop(600)
    expect(out).toEqual([])
  })
})

const topic = (id: string, parentId: string | null, order: number, from: number, to: number): Topic => ({
  id,
  docId: 'd',
  parentId,
  order,
  title: id,
  pageStart: from,
  pageEnd: to,
  objectives: [],
  estimates: null,
  mastery: null
})

describe('topic tree', () => {
  const topics = [topic('b', null, 2, 31, 50), topic('a', null, 0, 13, 30), topic('a1', 'a', 1, 13, 21)]
  it('nests children under parents in order', () => {
    const tree = buildTopicTree(topics)
    expect(tree.map((n) => n.topic.id)).toEqual(['a', 'b'])
    expect(tree[0]?.children.map((n) => n.topic.id)).toEqual(['a1'])
  })
  it('finds the deepest topic for a page', () => {
    expect(topicAt(topics, 15)?.id).toBe('a1')
    expect(topicAt(topics, 25)?.id).toBe('a')
    expect(topicAt(topics, 99)).toBeNull()
  })
})
