import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { PDFDocumentProxy } from 'pdfjs-dist/legacy/build/pdf.mjs'
import type { TextItem, TextMarkedContent } from 'pdfjs-dist/types/src/display/api'
import { asLibraryError, io } from './errors'
import { resolveOutline, type DestinationResolver } from './outline'
import type { PdfExtract } from './schemas'
import { chooseTitle, hasTextLayer, joinTextRuns, normaliseText, type TextRun } from './text'
import { LibraryError, type PageExtract } from './types'

/**
 * Extraction core: text, labels, outline and title of a PDF with pdf.js. A plain async function so it
 * is tested in-process; in the app it runs inside the PDF worker thread (see worker-client.ts).
 */

/** Reads a PDF from disk and extracts it. `fileName` is the title of last resort. */
export async function extractPdfFile(path: string, fileName: string): Promise<PdfExtract> {
  const file = await io(`Cannot read ${path}`, () => readFile(path))
  // A plain Uint8Array over the whole buffer: pdf.js copies Buffers, but takes (transfers) this as is.
  return extractPdfData(new Uint8Array(file.buffer, file.byteOffset, file.byteLength), fileName)
}

/**
 * Extracts a PDF from bytes. pdf.js takes ownership of `data` (it may be detached afterwards).
 * Throws LibraryError `encrypted` for password-protected files and `corrupt` for unreadable ones.
 * Individual pages that fail to parse get empty text instead of failing the whole document.
 */
export async function extractPdfData(data: Uint8Array, fileName: string): Promise<PdfExtract> {
  const task = getDocument({
    data,
    // 0 = errors only: real-world PDFs trigger many harmless font warnings.
    verbosity: 0,
    // Text extraction needs no font rendering. (pdf.js 6 dropped `isEvalSupported`: it never evals now.)
    disableFontFace: true,
    ...pdfjsAssetUrls()
  })
  try {
    const doc = await task.promise.catch((err: unknown) => {
      throw openError(err)
    })
    return await readDocument(doc, fileName)
  } catch (err) {
    throw asLibraryError(err, 'corrupt', 'Could not extract the PDF')
  } finally {
    await task.destroy()
  }
}

async function readDocument(doc: PDFDocumentProxy, fileName: string): Promise<PdfExtract> {
  if (doc.numPages < 1) throw new LibraryError('corrupt', 'The PDF has no pages')
  const labels = await doc.getPageLabels().catch(() => null)
  const pages: PageExtract[] = []
  let failedPages = 0
  for (let n = 1; n <= doc.numPages; n++) {
    const text = await pageText(doc, n).catch(() => {
      failedPages++
      return ''
    })
    pages.push({
      page: n,
      label: labels?.[n - 1] || null,
      text,
      charCount: text.length,
      hasTextLayer: hasTextLayer(text)
    })
  }
  if (failedPages === doc.numPages) throw new LibraryError('corrupt', 'No page of the PDF could be read')

  const rawOutline = await doc.getOutline().catch(() => null)
  const outline = await resolveOutline(rawOutline ?? [], destinationResolver(doc))
  const title = chooseTitle({
    metadata: await metadataTitles(doc),
    firstPageText: pages[0]?.text ?? '',
    fileName
  })
  return { title, pageCount: doc.numPages, outline, pages }
}

async function pageText(doc: PDFDocumentProxy, pageNumber: number): Promise<string> {
  const page = await doc.getPage(pageNumber)
  try {
    const content = await page.getTextContent()
    return normaliseText(joinTextRuns(content.items.flatMap(toTextRun)))
  } finally {
    // Frees parsed page resources right away; long documents otherwise keep every page in memory.
    page.cleanup()
  }
}

function toTextRun(item: TextItem | TextMarkedContent): TextRun[] {
  if (!('str' in item)) return []
  const [a, b, c, , x, y] = item.transform.map(finite)
  return [
    {
      str: item.str,
      hasEOL: item.hasEOL,
      x: x ?? 0,
      y: y ?? 0,
      width: finite(item.width),
      height: finite(item.height),
      horizontal: Math.abs(b ?? 0) < 1e-6 && Math.abs(c ?? 0) < 1e-6 && (a ?? 0) > 0
    }
  ]
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/** Resolves named and explicit destinations to 1-based pages, caching page refs shared by many entries. */
function destinationResolver(doc: PDFDocumentProxy): DestinationResolver {
  const pageByRef = new Map<string, Promise<number | null>>()
  return async (dest) => {
    const explicit: unknown = typeof dest === 'string' ? await doc.getDestination(dest) : dest
    if (!Array.isArray(explicit)) return null
    const target: unknown = explicit[0]
    // Some generators write a 0-based page index instead of a page reference.
    if (typeof target === 'number') {
      return Number.isInteger(target) && target >= 0 && target < doc.numPages ? target + 1 : null
    }
    if (!isRefProxy(target)) return null
    const key = `${target.num}R${target.gen}`
    let page = pageByRef.get(key)
    if (!page) {
      page = doc.getPageIndex(target).then(
        (index) => index + 1,
        () => null
      )
      pageByRef.set(key, page)
    }
    return page
  }
}

function isRefProxy(value: unknown): value is { num: number; gen: number } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'num' in value &&
    'gen' in value &&
    Number.isInteger(value.num) &&
    Number.isInteger(value.gen)
  )
}

/** Title candidates from XMP (preferred, usually cleaner Unicode) and the Info dictionary. */
async function metadataTitles(doc: PDFDocumentProxy): Promise<(string | null)[]> {
  const meta = await doc.getMetadata().catch(() => null)
  if (!meta) return []
  const xmp: unknown = meta.metadata?.get('dc:title')
  const info: unknown = meta.info
  const infoTitle =
    typeof info === 'object' && info !== null && 'Title' in info && typeof info.Title === 'string'
      ? info.Title
      : null
  return [typeof xmp === 'string' ? xmp : null, infoTitle]
}

function openError(err: unknown): LibraryError {
  const name = err instanceof Error ? err.name : ''
  if (name === 'PasswordException') {
    return new LibraryError('encrypted', 'The PDF is password-protected', err)
  }
  return asLibraryError(err, 'corrupt', 'The PDF is damaged or not a valid PDF')
}

/**
 * Standard-font metrics and CJK CMaps shipped with pdfjs-dist. Without them text extraction still
 * works, but non-embedded fonts and predefined CMaps (common in Asian PDFs) map characters worse.
 * Resolved from the installed package so it works from sources and from the bundled worker.
 */
function pdfjsAssetUrls(): { standardFontDataUrl?: string; cMapUrl?: string; cMapPacked?: boolean } {
  try {
    const root = dirname(createRequire(import.meta.url).resolve('pdfjs-dist/package.json'))
    // pdf.js concatenates file names onto these and insists on a trailing slash.
    return {
      standardFontDataUrl: `${join(root, 'standard_fonts')}/`,
      cMapUrl: `${join(root, 'cmaps')}/`,
      cMapPacked: true
    }
  } catch {
    return {}
  }
}
