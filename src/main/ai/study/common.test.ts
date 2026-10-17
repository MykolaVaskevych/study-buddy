import { resolveOptions, selectChunks } from './common'

const chunk = (index: number, startPage: number, endPage: number, bytes = 1000) => ({
  index,
  startPage,
  endPage,
  path: `/c${index}.pdf`,
  bytes
})
const grid = [chunk(2, 21, 30), chunk(0, 1, 10), chunk(1, 11, 20)]
const limits = resolveOptions({})

describe('selectChunks', () => {
  it('returns the chunks overlapping the range in page order', () => {
    expect(selectChunks(grid, 8, 12, limits).map((c) => c.index)).toEqual([0, 1])
    expect(selectChunks(grid, 11, 11, limits).map((c) => c.index)).toEqual([1])
  })

  it('rejects invalid or uncovered ranges', () => {
    expect(() => selectChunks(grid, 5, 3, limits)).toThrow(/Invalid page range/)
    expect(() => selectChunks(grid, 0, 3, limits)).toThrow(/Invalid page range/)
    expect(() => selectChunks(grid, 25, 35, limits)).toThrow(/covers page 31/)
    expect(() => selectChunks([chunk(0, 1, 10), chunk(2, 21, 30)], 5, 25, limits)).toThrow(/covers page 11/)
  })

  it('rejects scopes too large for one request instead of dropping pages', () => {
    expect(() => selectChunks(grid, 1, 30, { maxRequestBytes: 2500, maxRequestPages: 100 })).toThrow(
      /split the range/
    )
    expect(() => selectChunks(grid, 1, 30, { maxRequestBytes: 1e9, maxRequestPages: 25 })).toThrow(
      /split the range/
    )
    expect(() => selectChunks(grid, 1, 30, limits)).not.toThrow()
  })
})
