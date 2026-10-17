import type { Topic } from '@shared/domain'
import type { ChunkInfo } from '../library/types'
import { focusChunkRange, leafTopics, leavesUnder, planWindows, scopeKey, topicPieces } from './scope'

const MB = 1024 * 1024

/** A 10-page grid over `pages` pages, every chunk `bytes` large. */
function grid(pages: number, bytes = 1 * MB): ChunkInfo[] {
  const out: ChunkInfo[] = []
  for (let start = 1, i = 0; start <= pages; start += 10, i++) {
    out.push({ index: i, startPage: start, endPage: Math.min(pages, start + 9), path: `/c/${i}.pdf`, bytes })
  }
  return out
}

function topic(id: string, pageStart: number, pageEnd: number, parentId: string | null = null): Topic {
  return {
    id,
    docId: 'd',
    parentId,
    order: 0,
    title: id,
    pageStart,
    pageEnd,
    objectives: [],
    estimates: null,
    mastery: null
  }
}

const limits = { windowPages: 40, maxBytes: 22 * MB }

describe('planWindows', () => {
  it('keeps a range that fits as one window', () => {
    expect(
      planWindows({ from: 3, to: 30 }, { leaves: [], grid: grid(120), byTopic: false, ...limits })
    ).toEqual([{ from: 3, to: 30 }])
  })

  it('splits a 120-page range without topics into equal windows of at most 40 pages', () => {
    expect(
      planWindows({ from: 1, to: 120 }, { leaves: [], grid: grid(120), byTopic: false, ...limits })
    ).toEqual([
      { from: 1, to: 40 },
      { from: 41, to: 80 },
      { from: 81, to: 120 }
    ])
  })

  it('follows topic boundaries, splits big topics and merges small neighbours', () => {
    const leaves = [topic('a', 1, 12), topic('b', 13, 20), topic('c', 21, 90), topic('d', 91, 96)]
    expect(planWindows({ from: 1, to: 100 }, { leaves, grid: grid(100), byTopic: false, ...limits })).toEqual(
      [
        { from: 1, to: 20 }, // a + b merged
        { from: 21, to: 55 }, // c halved
        { from: 56, to: 90 }, // second half of c: with d it would be 41 pages
        { from: 91, to: 100 } // d + the untitled tail merged
      ]
    )
  })

  it('by topic (document scope): one window per topic, never merged', () => {
    const leaves = [topic('a', 1, 4), topic('b', 5, 9), topic('c', 10, 12)]
    expect(planWindows({ from: 1, to: 12 }, { leaves, grid: grid(12), byTopic: true, ...limits })).toEqual([
      { from: 1, to: 4 },
      { from: 5, to: 9 },
      { from: 10, to: 12 }
    ])
  })

  it('halves windows whose chunks exceed the byte limit (image-heavy PDFs)', () => {
    // 8 MB per 10-page chunk: 3 chunks (24 MB) are too many for one request.
    const heavy = grid(40, 8 * MB)
    const windows = planWindows({ from: 1, to: 40 }, { leaves: [], grid: heavy, byTopic: false, ...limits })
    expect(windows).toEqual([
      { from: 1, to: 20 },
      { from: 21, to: 40 }
    ])
  })
})

describe('topicPieces', () => {
  it('tiles the range: clipped topics plus the gaps between them, overlaps resolved', () => {
    const leaves = [topic('b', 8, 12), topic('a', 3, 5), topic('overlap', 10, 14)]
    expect(topicPieces({ from: 1, to: 20 }, leaves)).toEqual([
      { from: 1, to: 2 },
      { from: 3, to: 5 },
      { from: 6, to: 7 },
      { from: 8, to: 12 },
      { from: 13, to: 14 },
      { from: 15, to: 20 }
    ])
    expect(topicPieces({ from: 4, to: 9 }, leaves)).toEqual([
      { from: 4, to: 5 },
      { from: 6, to: 7 },
      { from: 8, to: 9 }
    ])
  })
})

describe('focusChunkRange', () => {
  const g = grid(30)

  it('sends the page and its neighbours instead of the whole chunk', () => {
    expect(focusChunkRange({ from: 5, to: 5 }, 30, g, 12)).toEqual({ from: 4, to: 6 })
    expect(focusChunkRange({ from: 1, to: 1 }, 30, g, 12)).toEqual({ from: 1, to: 2 })
    expect(focusChunkRange({ from: 30, to: 30 }, 30, g, 12)).toEqual({ from: 29, to: 30 })
    // 9-12 spans two chunks (20 pages): 8-13 is far smaller.
    expect(focusChunkRange({ from: 9, to: 12 }, 30, g, 12)).toEqual({ from: 8, to: 13 })
  })

  it('keeps grid chunks when they are as small (aligned) or the range is large', () => {
    expect(focusChunkRange({ from: 1, to: 10 }, 30, g, 12)).toBeNull()
    expect(focusChunkRange({ from: 2, to: 9 }, 30, g, 12)).toBeNull()
    expect(focusChunkRange({ from: 5, to: 20 }, 30, g, 12)).toBeNull()
  })
})

describe('topic helpers', () => {
  const topics = [
    topic('ch1', 1, 10),
    topic('t1', 1, 5, 'ch1'),
    topic('t2', 6, 10, 'ch1'),
    topic('ch2', 11, 12)
  ]

  it('finds leaves overall and below a topic', () => {
    expect(leafTopics(topics).map((t) => t.id)).toEqual(['t1', 't2', 'ch2'])
    expect(leavesUnder(topics, 'ch1').map((t) => t.id)).toEqual(['t1', 't2'])
    expect(leavesUnder(topics, 't2').map((t) => t.id)).toEqual(['t2'])
  })

  it('scope keys are stable and order-insensitive for ranges', () => {
    expect(scopeKey({ kind: 'range', docId: 'd', from: 9, to: 3 })).toBe(
      scopeKey({ kind: 'range', docId: 'd', from: 3, to: 9 })
    )
    expect(scopeKey({ kind: 'page', docId: 'd', page: 3 })).toBe('d:p3')
    expect(scopeKey({ kind: 'topic', docId: 'd', topicId: 't' })).toBe('d:tt')
    expect(scopeKey({ kind: 'document', docId: 'd' })).toBe('d:all')
  })
})
