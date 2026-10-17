import { memo, useCallback, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react'
import type { CSSProperties, Ref } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { effectiveZoom, fitWidthZoom, PDF_TO_CSS } from '../zoom'
import type { Zoom } from '../zoom'
import { PdfPageCanvas } from './PdfPageCanvas'
import { pickCurrentPage } from './visibility'

export interface PdfViewerHandle {
  /** Scrolls to a page. `flash` draws the highlighter sweep (citations, search, course map). */
  jumpTo: (page: number, options?: { flash?: boolean }) => void
}

interface Size {
  width: number
  height: number
}

interface Props {
  doc: PDFDocumentProxy
  firstPage: Size
  initialPage: number
  zoom: Zoom
  onPageChange: (page: number) => void
  /** Effective zoom factor (for the toolbar's "100%" readout and zoom steps from fit). */
  onZoomFactor: (factor: number) => void
  /** Ctrl + wheel. */
  onZoomStep: (dir: 1 | -1) => void
  ref?: Ref<PdfViewerHandle>
}

const GAP = 16
const RENDER_DEBOUNCE_MS = 140
const THRESHOLDS = Array.from({ length: 11 }, (_, i) => i / 10)

function useDevicePixelRatio(): number {
  const [dpr, setDpr] = useState(() => window.devicePixelRatio || 1)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return
    const mq = window.matchMedia(`(resolution: ${dpr}dppx)`)
    const onChange = (): void => setDpr(window.devicePixelRatio || 1)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [dpr])
  return dpr
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

interface SlotProps {
  page: number
  width: number
  height: number
  scale: number
  near: boolean
  flashKey: number | null
  doc: PDFDocumentProxy
  renderScale: number
  dpr: number
  register: (page: number, el: HTMLDivElement | null) => void
  onSize: (page: number, w: number, h: number) => void
}

/** One page placeholder; only pages near the viewport mount a canvas. */
const PageSlot = memo(function PageSlot({
  page,
  width,
  height,
  scale,
  near,
  flashKey,
  doc,
  renderScale,
  dpr,
  register,
  onSize
}: SlotProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    register(page, ref.current)
    return () => register(page, null)
  }, [page, register])
  const style = {
    width: Math.floor(width),
    height: Math.floor(height),
    '--total-scale-factor': scale
  } as CSSProperties
  return (
    <div ref={ref} data-page={page} data-flash={flashKey ?? undefined} className="pdf-page" style={style}>
      {near ? (
        <PdfPageCanvas doc={doc} pageNumber={page} scale={renderScale} dpr={dpr} onSize={onSize} />
      ) : (
        <span
          aria-hidden
          className="tabular absolute inset-0 flex items-center justify-center text-sm text-black/25"
        >
          {page}
        </span>
      )}
    </div>
  )
})

/**
 * Continuous-scroll PDF viewer. Every page has a sized placeholder (cheap divs, so scroll height
 * is right from the start); IntersectionObservers decide which pages get a canvas and which page
 * is current. Zoom and late page-size corrections keep the reading position anchored.
 */
export function PdfViewer({
  doc,
  firstPage,
  initialPage,
  zoom,
  onPageChange,
  onZoomFactor,
  onZoomStep,
  ref
}: Props): React.JSX.Element {
  const numPages = doc.numPages
  const scroller = useRef<HTMLDivElement>(null)
  const pageEls = useRef(new Map<number, HTMLDivElement>())
  const [sizes, setSizes] = useState<Size[]>(() => Array.from({ length: numPages }, () => firstPage))
  const [containerWidth, setContainerWidth] = useState(0)
  const [near, setNear] = useState<ReadonlySet<number>>(() => new Set([initialPage]))
  const [flash, setFlash] = useState<{ page: number; key: number } | null>(null)
  const current = useRef(initialPage)
  const anchor = useRef<{ page: number; offset: number }>({ page: initialPage, offset: 0 })
  const dpr = useDevicePixelRatio()

  const fit = fitWidthZoom(containerWidth, firstPage.width)
  const factor = effectiveZoom(zoom, fit)
  const scale = factor * PDF_TO_CSS
  const renderScale = useDebounced(scale, RENDER_DEBOUNCE_MS)

  useEffect(() => onZoomFactor(factor), [factor, onZoomFactor])

  // ---- container width (fit-width)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    setContainerWidth(el.clientWidth)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setContainerWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // ---- page-size corrections, batched per frame
  const pendingSizes = useRef(new Map<number, Size>())
  const sizeFrame = useRef<number | null>(null)
  const onSize = useCallback((page: number, width: number, height: number) => {
    pendingSizes.current.set(page, { width, height })
    if (sizeFrame.current !== null) return
    sizeFrame.current = requestAnimationFrame(() => {
      sizeFrame.current = null
      const updates = pendingSizes.current
      pendingSizes.current = new Map()
      setSizes((prev) => {
        let changed = false
        const next = prev.slice()
        for (const [p, s] of updates) {
          const old = next[p - 1]
          if (old && (Math.abs(old.width - s.width) > 0.5 || Math.abs(old.height - s.height) > 0.5)) {
            next[p - 1] = s
            changed = true
          }
        }
        return changed ? next : prev
      })
    })
  }, [])
  useEffect(
    () => () => {
      if (sizeFrame.current !== null) cancelAnimationFrame(sizeFrame.current)
    },
    []
  )

  // ---- anchor: remember where we are while scrolling, restore it after layout changes
  const updateAnchor = useCallback(() => {
    const el = scroller.current
    const pageEl = pageEls.current.get(current.current)
    if (!el || !pageEl) return
    anchor.current = {
      page: current.current,
      offset: (el.scrollTop - pageEl.offsetTop) / Math.max(1, pageEl.offsetHeight)
    }
  }, [])

  useLayoutEffect(() => {
    const el = scroller.current
    const pageEl = pageEls.current.get(anchor.current.page)
    if (!el || !pageEl) return
    el.scrollTop = pageEl.offsetTop + anchor.current.offset * pageEl.offsetHeight
  }, [scale, sizes])

  // ---- observers
  const nearObserver = useRef<IntersectionObserver | null>(null)
  const currentObserver = useRef<IntersectionObserver | null>(null)
  const visiblePx = useRef(new Map<number, number>())

  const register = useCallback((page: number, el: HTMLDivElement | null) => {
    const prev = pageEls.current.get(page)
    if (prev) {
      nearObserver.current?.unobserve(prev)
      currentObserver.current?.unobserve(prev)
    }
    if (el) {
      pageEls.current.set(page, el)
      nearObserver.current?.observe(el)
      currentObserver.current?.observe(el)
    } else pageEls.current.delete(page)
  }, [])

  useEffect(() => {
    const root = scroller.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const pageOf = (t: Element): number => Number((t as HTMLElement).dataset['page'])
    const nearIo = new IntersectionObserver(
      (entries) => {
        setNear((prev) => {
          const next = new Set(prev)
          for (const e of entries) {
            if (e.isIntersecting) next.add(pageOf(e.target))
            else next.delete(pageOf(e.target))
          }
          return next
        })
      },
      { root, rootMargin: '150% 0px' }
    )
    const currentIo = new IntersectionObserver(
      (entries) => {
        for (const e of entries)
          visiblePx.current.set(pageOf(e.target), e.isIntersecting ? e.intersectionRect.height : 0)
        const page = pickCurrentPage(visiblePx.current)
        if (page !== null && page !== current.current) {
          current.current = page
          onPageChange(page)
        }
      },
      { root, threshold: THRESHOLDS }
    )
    nearObserver.current = nearIo
    currentObserver.current = currentIo
    for (const el of pageEls.current.values()) {
      nearIo.observe(el)
      currentIo.observe(el)
    }
    return () => {
      nearIo.disconnect()
      currentIo.disconnect()
      nearObserver.current = null
      currentObserver.current = null
    }
  }, [onPageChange])

  // ---- initial position (later jumps go through the handle)
  const [startPage] = useState(initialPage)
  useLayoutEffect(() => {
    anchor.current = { page: startPage, offset: 0 }
    const el = scroller.current
    const pageEl = pageEls.current.get(startPage)
    if (el && pageEl) el.scrollTop = pageEl.offsetTop - GAP
  }, [startPage])

  // ---- Ctrl + wheel zoom (needs a non-passive listener to stop the browser zooming the UI)
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      onZoomStep(e.deltaY < 0 ? 1 : -1)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [onZoomStep])

  useImperativeHandle(
    ref,
    () => ({
      jumpTo: (page, options = {}) => {
        const target = Math.min(Math.max(1, Math.round(page)), numPages)
        const el = scroller.current
        const pageEl = pageEls.current.get(target)
        if (!el || !pageEl) return
        el.scrollTop = pageEl.offsetTop - GAP
        current.current = target
        anchor.current = { page: target, offset: -GAP / Math.max(1, pageEl.offsetHeight) }
        onPageChange(target)
        if (options.flash) setFlash({ page: target, key: Date.now() })
      }
    }),
    [numPages, onPageChange]
  )

  useEffect(() => {
    if (!flash) return
    const t = window.setTimeout(() => setFlash(null), 1400)
    return () => window.clearTimeout(t)
  }, [flash])

  return (
    <div
      ref={scroller}
      tabIndex={0}
      aria-label="PDF pages"
      onScroll={updateAnchor}
      className="h-full overflow-auto bg-desk outline-none focus-visible:outline-none"
    >
      <div
        className="relative flex flex-col items-center px-6"
        style={{ gap: GAP, paddingTop: GAP, paddingBottom: GAP * 4 }}
      >
        {sizes.map((s, i) => {
          const page = i + 1
          return (
            <PageSlot
              key={page}
              page={page}
              width={s.width * scale}
              height={s.height * scale}
              scale={scale}
              near={near.has(page)}
              flashKey={flash?.page === page ? flash.key : null}
              doc={doc}
              renderScale={renderScale}
              dpr={dpr}
              register={register}
              onSize={onSize}
            />
          )
        })}
      </div>
    </div>
  )
}
