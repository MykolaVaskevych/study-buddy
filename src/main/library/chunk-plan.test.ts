import {
  halveRange,
  isTiling,
  normaliseRotation,
  planChunkRanges,
  stampPlacement,
  stampText
} from './chunk-plan'

describe('planChunkRanges', () => {
  it('cuts the document into consecutive ranges', () => {
    expect(planChunkRanges(12, 10)).toEqual([
      { startPage: 1, endPage: 10 },
      { startPage: 11, endPage: 12 }
    ])
    expect(planChunkRanges(10, 10)).toEqual([{ startPage: 1, endPage: 10 }])
    expect(planChunkRanges(3, 1)).toHaveLength(3)
  })
})

describe('halveRange', () => {
  it('splits in halves and stops at a single page', () => {
    expect(halveRange({ startPage: 1, endPage: 10 })).toEqual([
      { startPage: 1, endPage: 5 },
      { startPage: 6, endPage: 10 }
    ])
    expect(halveRange({ startPage: 11, endPage: 13 })).toEqual([
      { startPage: 11, endPage: 12 },
      { startPage: 13, endPage: 13 }
    ])
    expect(halveRange({ startPage: 4, endPage: 4 })).toBeNull()
  })
})

describe('isTiling', () => {
  it('accepts only gap-free ordered coverage of every page', () => {
    expect(isTiling(planChunkRanges(12, 5), 12)).toBe(true)
    expect(isTiling([{ startPage: 1, endPage: 5 }], 6)).toBe(false)
    expect(
      isTiling(
        [
          { startPage: 1, endPage: 3 },
          { startPage: 5, endPage: 6 }
        ],
        6
      )
    ).toBe(false)
  })
})

describe('stamp placement', () => {
  const box = { x: 10, y: 20, width: 600, height: 400 }

  it('formats the stamp', () => {
    expect(stampText(11)).toBe('SB-PAGE 11')
  })

  it('normalises any /Rotate value', () => {
    expect([0, 90, -90, 450, 180, 270, 360].map(normaliseRotation)).toEqual([0, 90, 270, 90, 180, 270, 0])
  })

  it('targets the displayed bottom-right corner for each rotation', () => {
    expect(stampPlacement(box, 0, 40, 4)).toEqual({ x: 566, y: 24, rotate: 0 })
    expect(stampPlacement(box, 90, 40, 4)).toEqual({ x: 606, y: 376, rotate: 90 })
    expect(stampPlacement(box, 180, 40, 4)).toEqual({ x: 54, y: 416, rotate: 180 })
    expect(stampPlacement(box, 270, 40, 4)).toEqual({ x: 14, y: 64, rotate: 270 })
  })

  it('keeps the start of long text inside tiny pages', () => {
    expect(stampPlacement({ x: 0, y: 0, width: 20, height: 20 }, 0, 40, 4).x).toBe(0)
  })
})
