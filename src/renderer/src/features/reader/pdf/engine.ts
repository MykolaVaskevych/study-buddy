import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PdfSource } from '../../../api/pdfSource'

// The worker is bundled by Vite and served from 'self', which the CSP's worker-src allows.
GlobalWorkerOptions.workerSrc = workerUrl

/**
 * Opens a PDF. URL sources are fetched here rather than by pdf.js: pdf.js only streams http(s)
 * and would fall back to XHR for the custom sb-pdf: scheme, while fetch is what the scheme's
 * `supportFetchAPI` privilege guarantees.
 */
export async function openPdf(source: PdfSource, signal: AbortSignal): Promise<PDFDocumentProxy> {
  let data: Uint8Array
  if (source.kind === 'data') data = source.data
  else {
    const res = await fetch(source.url, { signal })
    if (!res.ok) throw new Error(`Could not load the PDF (${res.status})`)
    data = new Uint8Array(await res.arrayBuffer())
  }
  const task = getDocument({ data, stopAtErrors: false })
  // Destroying the loading task also destroys the document and frees the worker's memory.
  signal.addEventListener('abort', () => void task.destroy(), { once: true })
  return task.promise
}
