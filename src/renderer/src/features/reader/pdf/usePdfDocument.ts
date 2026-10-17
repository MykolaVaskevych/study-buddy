import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { resolvePdfSource } from '../../../api/pdfSource'
import { openPdf } from './engine'

export type PdfState =
  | { status: 'loading' }
  | { status: 'ready'; doc: PDFDocumentProxy; firstPage: { width: number; height: number } }
  | { status: 'error'; error: Error }

/**
 * Loads the document's PDF and destroys it (freeing the worker's memory) on unmount. Kept out
 * of the query cache on purpose: a PDFDocumentProxy owns worker resources and must be released.
 */
export function usePdfDocument(docId: string, attempt = 0): PdfState {
  const [state, setState] = useState<PdfState>({ status: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    resolvePdfSource(docId)
      .then((source) => openPdf(source, controller.signal))
      .then(async (opened) => {
        const page = await opened.getPage(1)
        const vp = page.getViewport({ scale: 1 })
        if (!controller.signal.aborted)
          setState({ status: 'ready', doc: opened, firstPage: { width: vp.width, height: vp.height } })
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted)
          setState({ status: 'error', error: e instanceof Error ? e : new Error(String(e)) })
      })
    return () => {
      controller.abort()
      // Aborting destroys the pdf.js loading task and with it the document (see openPdf).
      setState({ status: 'loading' })
    }
  }, [docId, attempt])

  return state
}
