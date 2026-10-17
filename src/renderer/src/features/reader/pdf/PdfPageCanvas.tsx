import { useEffect, useRef } from 'react'
import { RenderingCancelledException, TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { outputScale } from './visibility'

interface Props {
  doc: PDFDocumentProxy
  pageNumber: number
  /** pdf.js viewport scale (CSS px per PDF point). */
  scale: number
  dpr: number
  /** Real page size in points, reported once the page is loaded. */
  onSize: (page: number, width: number, height: number) => void
}

/** Pages flying past during fast scrolls never start rendering. */
const START_DELAY_MS = 40

/**
 * Canvas + text layer for one page: the only place that touches pdf.js rendering, kept behind
 * this boundary because canvas output can't be tested in happy-dom. A re-render at a new scale
 * draws to a fresh canvas and swaps it in, so zooming never flashes a blank page.
 */
export function PdfPageCanvas({ doc, pageNumber, scale, dpr, onSize }: Props): React.JSX.Element {
  const canvasHost = useRef<HTMLDivElement>(null)
  const textHost = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let cancelled = false
    let task: RenderTask | null = null
    let text: TextLayer | null = null
    const timer = window.setTimeout(() => {
      void (async () => {
        try {
          const page = await doc.getPage(pageNumber)
          if (cancelled) return
          const base = page.getViewport({ scale: 1 })
          onSize(pageNumber, base.width, base.height)
          const viewport = page.getViewport({ scale })
          const ratio = outputScale(dpr, viewport.width, viewport.height)
          const canvas = document.createElement('canvas')
          canvas.width = Math.floor(viewport.width * ratio)
          canvas.height = Math.floor(viewport.height * ratio)
          task = page.render({
            canvas,
            viewport,
            transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0]
          })
          await task.promise
          if (cancelled) return
          canvasHost.current?.replaceChildren(canvas)

          const host = textHost.current
          if (!host) return
          host.replaceChildren()
          text = new TextLayer({ textContentSource: page.streamTextContent(), container: host, viewport })
          await text.render()
        } catch (e) {
          if (e instanceof RenderingCancelledException || cancelled) return
          console.warn(`[pdf] page ${pageNumber} failed to render`, e)
        }
      })()
    }, START_DELAY_MS)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
      task?.cancel()
      text?.cancel()
    }
  }, [doc, pageNumber, scale, dpr, onSize])

  useEffect(() => {
    const host = canvasHost.current
    return () => {
      // Release the bitmap right away; detached canvases can linger until GC otherwise.
      for (const c of host?.querySelectorAll('canvas') ?? []) {
        c.width = 0
        c.height = 0
      }
    }
  }, [])

  return (
    <>
      <div ref={canvasHost} className="pdf-canvas-host" />
      <div ref={textHost} className="textLayer" />
    </>
  )
}
