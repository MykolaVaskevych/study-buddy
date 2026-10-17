/**
 * Pure geometry and planning for the chunk grid: which pages go into which chunk, how an oversized
 * chunk is split, and where the page stamp goes. No pdf-lib here, so the rules are unit-tested directly.
 */

/** Absolute, inclusive, 1-based page range. */
export interface PageRange {
  startPage: number
  endPage: number
}

/** Every chunk page is stamped "SB-PAGE <n>" so a model reading the chunk sees absolute page numbers. */
export const PAGE_STAMP_PREFIX = 'SB-PAGE'

export const STAMP_STYLE = {
  /** Small enough to stay out of the way, large enough to survive rendering at ~100 dpi. */
  fontSize: 7,
  /** Distance of the baseline from the bottom edge and of the text end from the right edge, in points. */
  inset: 4,
  /** Light grey: readable on white, still visible on mid-tone backgrounds. */
  grey: 0.6
} as const

export function stampText(page: number): string {
  return `${PAGE_STAMP_PREFIX} ${page}`
}

/** Splits 1..pageCount into consecutive ranges of at most `pagesPerChunk` pages. */
export function planChunkRanges(pageCount: number, pagesPerChunk: number): PageRange[] {
  const ranges: PageRange[] = []
  for (let start = 1; start <= pageCount; start += pagesPerChunk) {
    ranges.push({ startPage: start, endPage: Math.min(start + pagesPerChunk - 1, pageCount) })
  }
  return ranges
}

/** Halves a range (first half gets the extra page), or returns null for a single page. */
export function halveRange(range: PageRange): [PageRange, PageRange] | null {
  if (range.endPage <= range.startPage) return null
  const mid = Math.floor((range.startPage + range.endPage) / 2)
  return [
    { startPage: range.startPage, endPage: mid },
    { startPage: mid + 1, endPage: range.endPage }
  ]
}

/** True when the ranges cover 1..pageCount exactly once, in order. */
export function isTiling(ranges: readonly PageRange[], pageCount: number): boolean {
  let next = 1
  for (const range of ranges) {
    if (range.startPage !== next || range.endPage < range.startPage) return false
    next = range.endPage + 1
  }
  return next === pageCount + 1
}

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

export type QuarterTurn = 0 | 90 | 180 | 270

export interface StampPlacement {
  /** Text origin (start of the baseline) in unrotated PDF user space. */
  x: number
  y: number
  /** Counter-clockwise text rotation that makes the stamp read upright on the displayed page. */
  rotate: QuarterTurn
}

/** Maps any /Rotate value to 0, 90, 180 or 270 (the spec only allows multiples of 90). */
export function normaliseRotation(angle: number): QuarterTurn {
  const turns: readonly QuarterTurn[] = [0, 90, 180, 270]
  return turns[((Math.round(angle / 90) % 4) + 4) % 4] ?? 0
}

/**
 * Places the stamp in the bottom-right corner of the page *as displayed*. A page with /Rotate is shown
 * turned clockwise, so the visible bottom-right corner is a different corner of the unrotated box and the
 * text must be rotated to read upright. `box` should be the CropBox, the visible part of the page.
 * Long text on tiny pages is clamped so it starts inside the box.
 */
export function stampPlacement(box: Box, rotation: number, textWidth: number, inset: number): StampPlacement {
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.width
  const y1 = box.y + box.height
  switch (normaliseRotation(rotation)) {
    case 0:
      return { x: Math.max(x0, x1 - inset - textWidth), y: y0 + inset, rotate: 0 }
    case 90:
      return { x: x1 - inset, y: Math.max(y0, y1 - inset - textWidth), rotate: 90 }
    case 180:
      return { x: Math.min(x1, x0 + inset + textWidth), y: y1 - inset, rotate: 180 }
    case 270:
      return { x: x0 + inset, y: Math.min(y1, y0 + inset + textWidth), rotate: 270 }
  }
}
