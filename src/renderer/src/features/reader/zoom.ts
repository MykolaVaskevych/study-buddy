/** Zoom is either "fit the page width to the pane" or a fixed factor (1 = 100 %, physical size). */
export type Zoom = { mode: 'fit' } | { mode: 'scale'; scale: number }

export const ZOOM_STEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 4

/** PDF points are 1/72 in; CSS pixels are 1/96 in. 100 % means physical size. */
export const PDF_TO_CSS = 96 / 72

const clamp = (v: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v))

/** Zoom factor that makes a page of `pageWidthPt` points fill `containerWidth` CSS px minus gutters. */
export function fitWidthZoom(containerWidth: number, pageWidthPt: number, gutter = 48): number {
  if (containerWidth <= 0 || pageWidthPt <= 0) return 1
  return clamp((containerWidth - gutter) / (pageWidthPt * PDF_TO_CSS))
}

export function effectiveZoom(zoom: Zoom, fit: number): number {
  return zoom.mode === 'fit' ? fit : clamp(zoom.scale)
}

/** Next step up or down from the current factor (works from any fit value). */
export function stepZoom(current: number, dir: 1 | -1): number {
  const eps = 0.001
  if (dir > 0) return ZOOM_STEPS.find((s) => s > current + eps) ?? MAX_ZOOM
  return [...ZOOM_STEPS].reverse().find((s) => s < current - eps) ?? MIN_ZOOM
}

export const formatZoom = (factor: number): string => `${Math.round(factor * 100)}%`
