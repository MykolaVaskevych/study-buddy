/**
 * Current page = the page with the most visible pixels; ties go to the earlier page. Fed by the
 * IntersectionObserver in PdfViewer. Returns null when nothing is visible.
 */
export function pickCurrentPage(visible: ReadonlyMap<number, number>): number | null {
  let best: number | null = null
  let bestPx = 0
  for (const [page, px] of visible) {
    if (px <= 0) continue
    if (px > bestPx + 0.5 || (Math.abs(px - bestPx) <= 0.5 && best !== null && page < best)) {
      best = page
      bestPx = px
    }
  }
  return best
}

/** Largest device-pixel ratio that keeps a canvas under `maxPixels` (memory guard at high zoom). */
export function outputScale(
  dpr: number,
  cssWidth: number,
  cssHeight: number,
  maxPixels = 16_777_216
): number {
  const area = cssWidth * cssHeight
  if (area <= 0) return dpr
  return Math.max(0.5, Math.min(dpr, Math.sqrt(maxPixels / area)))
}
