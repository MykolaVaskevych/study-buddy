import { copyFile, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { isImage, isMarkdown, needsConversion } from '@shared/files'
import { PAGE_STAMP_PREFIX } from './chunk-plan'
import { readCompleteChunkGrid } from './chunks'
import { errorMessage, io } from './errors'
import { readExtractCache, writeExtractCache } from './extract-cache'
import { FOCUS_CHUNK_INDEX, writeFocusChunk } from './focus'
import type { PdfJob } from './job'
import { assertSha256, chunksDir, documentDir, extractCachePath, focusFilePath, storedPdfPath } from './paths'
import { imagesToPdf } from './images'
import { markdownTitle } from './markdown'
import { pptxNotes } from './pptx-notes'
import { installHint, type OfficeConverter } from './office'
import { hashFile, storeSourcePdf } from './store'
import { hasTextLayer } from './text'
import {
  LibraryError,
  type ChunkInfo,
  type ChunkOptions,
  type ChunkPageText,
  type ImportedPdf,
  type PageExtract,
  type LibraryConfig,
  type PdfLibrary
} from './types'
import { DEFAULT_WORKER_TIMEOUT_MS, processPdf, type ProcessOptions } from './worker-client'

export { PAGE_STAMP_PREFIX, stampText } from './chunk-plan'
export { FOCUS_CHUNK_INDEX } from './focus'
export { hasTextLayer } from './text'
export { createOfficeConverter, findSoffice } from './office'

/** 10 pages keeps a chunk well inside one model call; 20 MB leaves headroom under the 32 MB API limit. */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { pagesPerChunk: 10, maxChunkBytes: 20 * 1024 * 1024 }

/** Page texts kept in memory: a few books' worth of chunks, so retries and follow-ups skip the worker. */
const PAGE_TEXT_CACHE_SIZE = 64

const STAMP = new RegExp(`\\s*${PAGE_STAMP_PREFIX} (\\d+)\\s*`)

/** Splits the SB-PAGE stamp from a chunk page's text. */
export function splitStamp(text: string): ChunkPageText {
  const match = STAMP.exec(text)
  const rest = match
    ? `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.trim()
    : text
  return { page: match?.[1] ? Number(match[1]) : null, text: rest, hasTextLayer: hasTextLayer(rest) }
}

/** Each slide's speaker notes appended to its page's text (page i is slide i of the deck). */
export function withNotes(pages: readonly PageExtract[], notes: readonly string[]): PageExtract[] {
  return pages.map((p, i) => {
    const note = notes[i]?.trim()
    if (!note) return p
    const text = p.text ? `${p.text}\n\nSpeaker notes: ${note}` : `Speaker notes: ${note}`
    return { ...p, text, charCount: text.length }
  })
}

/** Larger files are almost always scans or media dumps that would take minutes and gigabytes to process. */
export const DEFAULT_MAX_PDF_BYTES = 500 * 1024 * 1024

/** Knobs that are not part of the contract: they exist for tests and tools. Defaults suit the app. */
export interface LibraryRuntimeOptions {
  /** Run pdf.js / pdf-lib in a worker thread (default true). False runs them on the calling thread. */
  inWorker?: boolean
  /** Reject sources above this size as `too_large` (default {@link DEFAULT_MAX_PDF_BYTES}). */
  maxPdfBytes?: number
  /** Give up on a file after this long (default 5 minutes). */
  workerTimeoutMs?: number
  /** Turns PowerPoint, Word and OpenDocument files into PDFs; without it they fail as `converter_missing`. */
  officeConverter?: OfficeConverter
  /** Prints Markdown notes to PDF (the app's renderer in a hidden window). */
  markdownToPdf?: (markdown: string, title: string) => Promise<Uint8Array>
}

/**
 * Creates the PDF library: file import, extraction and chunk grid on disk. No database access; pipelines
 * persist what `importPdf` returns. All failures are `LibraryError`s.
 */
export function createPdfLibrary(config: LibraryConfig, runtime: LibraryRuntimeOptions = {}): PdfLibrary {
  assertChunkOptions(config.chunk)
  const root = config.rootDir
  const chunkOptions: ChunkOptions = { ...config.chunk }
  const maxPdfBytes = runtime.maxPdfBytes ?? DEFAULT_MAX_PDF_BYTES
  const processing: ProcessOptions = {
    inWorker: runtime.inWorker ?? true,
    timeoutMs: runtime.workerTimeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS
  }

  const pageTextCache = new Map<string, ChunkPageText[]>()

  async function pageTexts(path: string): Promise<ChunkPageText[]> {
    const info = await io(`Cannot read ${basename(path)}`, () => stat(path))
    const key = `${path}|${info.size}|${info.mtimeMs}`
    const hit = pageTextCache.get(key)
    if (hit) return hit
    const result = await processPdf(
      { pdfPath: path, extract: { fileName: basename(path) }, chunks: null },
      processing
    )
    if (!result.extract) throw new LibraryError('io', 'PDF processing returned no text')
    const pages = result.extract.pages.map((p) => splitStamp(p.text))
    if (pageTextCache.size >= PAGE_TEXT_CACHE_SIZE) {
      const oldest = pageTextCache.keys().next()
      if (!oldest.done) pageTextCache.delete(oldest.value)
    }
    pageTextCache.set(key, pages)
    return pages
  }

  async function removeFiles(sha256: string): Promise<void> {
    await io('Cannot delete library files', async () => {
      await rm(storedPdfPath(root, sha256), { force: true })
      await rm(documentDir(root, sha256), { recursive: true, force: true })
    })
  }

  /** Imports a PDF; `fileName` is the title of last resort. */
  async function importStoredPdf(sourcePath: string, fileName: string): Promise<ImportedPdf> {
    const { sha256, storedPath } = await storeSourcePdf(sourcePath, root, maxPdfBytes)
    const cachePath = extractCachePath(root, sha256)
    const dir = chunksDir(root, sha256)

    // Re-import: cached extraction plus an intact grid means nothing to compute.
    const cached = await readExtractCache(cachePath)
    let extract = cached
    let chunks = cached ? await readCompleteChunkGrid(dir, cached.pageCount, chunkOptions) : null

    if (!extract || !chunks) {
      const job: PdfJob = {
        pdfPath: storedPath,
        extract: extract ? null : { fileName },
        chunks: chunks ? null : { dir, options: chunkOptions, expectedPageCount: extract?.pageCount ?? null }
      }
      const result = await processPdf(job, processing).catch(async (err: unknown) => {
        // A file that never imported successfully and cannot be read should not linger in the library.
        if (!cached && err instanceof LibraryError && (err.kind === 'corrupt' || err.kind === 'encrypted')) {
          await removeFiles(sha256).catch(() => undefined)
        }
        throw err
      })
      extract ??= result.extract
      chunks ??= result.chunks
      if (!extract || !chunks) throw new LibraryError('io', 'PDF processing returned an incomplete result')
      const fresh = extract
      if (!cached) await io('Cannot write the extraction cache', () => writeExtractCache(cachePath, fresh))
    }

    return {
      sha256,
      storedPath,
      title: extract.title,
      pageCount: extract.pageCount,
      outline: extract.outline,
      pages: extract.pages,
      chunks
    }
  }

  /**
   * Converted files (office documents, Markdown notes) are converted once: a note from the source's
   * hash to the PDF's hash lets a re-import reuse the stored PDF (conversions differ byte for byte
   * between runs, so they would duplicate). `convert` turns a copy under the library root into a PDF
   * in `work`: a plain name, and a path a host LibreOffice sees from the Flatpak sandbox.
   */
  async function importConverted(
    sourcePath: string,
    title: string,
    convert: (copy: string, work: string) => Promise<string>
  ): Promise<ImportedPdf> {
    const name = basename(sourcePath)
    const sourceSha = await io(`Cannot read ${name}`, () => hashFile(sourcePath))
    const notePath = join(root, 'converted', `${sourceSha}.txt`)
    const known = await readFile(notePath, 'utf8').then(
      (s) => s.trim(),
      () => ''
    )
    if (/^[0-9a-f]{64}$/.test(known)) {
      const stored = storedPdfPath(root, known)
      const present = await stat(stored).then(
        (s) => s.isFile(),
        () => false
      )
      if (present) return { ...(await importStoredPdf(stored, name)), title }
    }
    const work = join(root, 'converting', sourceSha)
    await rm(work, { recursive: true, force: true })
    try {
      await io('Cannot prepare the conversion folder', () => mkdir(work, { recursive: true }))
      const copy = join(work, name)
      await io(`Cannot read ${name}`, () => copyFile(sourcePath, copy))
      const imported = await importStoredPdf(await convert(copy, work), name)
      await io('Cannot save the conversion note', async () => {
        await mkdir(dirname(notePath), { recursive: true })
        await writeFile(notePath, imported.sha256)
      })
      return { ...imported, title }
    } finally {
      await rm(work, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /** The file name is the title: slide decks often carry a generic "PowerPoint Presentation" title. */
  async function importOffice(sourcePath: string): Promise<ImportedPdf> {
    const name = basename(sourcePath)
    const converter = runtime.officeConverter
    if (!converter) throw new LibraryError('converter_missing', installHint())
    const imported = await importConverted(sourcePath, basename(name, extname(name)), (copy, work) =>
      converter.toPdf(copy, work)
    )
    if (!/\.(pptx|ppsx)$/i.test(name)) return imported
    // The PDF export drops speaker notes; they are often the real explanation, so they join the text.
    const notes = pptxNotes(await io(`Cannot read ${name}`, () => readFile(sourcePath)))
    return { ...imported, pages: withNotes(imported.pages, notes) }
  }

  /** Photos and screenshots: one page per image. */
  function importImage(sourcePath: string): Promise<ImportedPdf> {
    const name = basename(sourcePath)
    return importConverted(sourcePath, basename(name, extname(name)), async (copy, work) => {
      const bytes = await io(`Cannot read ${name}`, () => readFile(copy))
      const pdf = join(work, `${basename(name, extname(name))}.pdf`)
      await io('Cannot write the image PDF', async () => writeFile(pdf, await imagesToPdf([{ name, bytes }])))
      return pdf
    })
  }

  /** Markdown and text notes are printed to PDF by the app's renderer; the first heading is the title. */
  async function importMarkdown(sourcePath: string): Promise<ImportedPdf> {
    const name = basename(sourcePath)
    const render = runtime.markdownToPdf
    if (!render)
      throw new LibraryError('conversion_failed', `Markdown notes cannot be imported here (${name})`)
    const markdown = await io(`Cannot read ${name}`, () => readFile(sourcePath, 'utf8'))
    const title = markdownTitle(markdown, basename(name, extname(name)))
    return importConverted(sourcePath, title, async (_copy, work) => {
      const bytes = await render(markdown, title).catch((err: unknown) => {
        throw new LibraryError('conversion_failed', `Could not render ${name}: ${errorMessage(err)}`, err)
      })
      const pdf = join(work, `${basename(name, extname(name))}.pdf`)
      await io('Cannot write the rendered notes', () => writeFile(pdf, bytes))
      return pdf
    })
  }

  function importPdf(sourcePath: string): Promise<ImportedPdf> {
    if (isMarkdown(sourcePath)) return importMarkdown(sourcePath)
    if (isImage(sourcePath)) return importImage(sourcePath)
    return needsConversion(sourcePath)
      ? importOffice(sourcePath)
      : importStoredPdf(sourcePath, basename(sourcePath))
  }

  async function ensureChunks(sha256: string, pageCount: number): Promise<ChunkInfo[]> {
    assertSha256(sha256)
    if (!Number.isInteger(pageCount) || pageCount < 1) {
      throw new LibraryError('io', `Invalid page count ${pageCount} for ${sha256}`)
    }
    const dir = chunksDir(root, sha256)
    const ready = await readCompleteChunkGrid(dir, pageCount, chunkOptions)
    if (ready) return ready

    const pdfPath = storedPdfPath(root, sha256)
    await io(`The stored PDF for ${sha256} is missing`, () => stat(pdfPath))
    const result = await processPdf(
      { pdfPath, extract: null, chunks: { dir, options: chunkOptions, expectedPageCount: pageCount } },
      processing
    )
    if (!result.chunks) throw new LibraryError('io', 'PDF processing returned no chunks')
    return result.chunks
  }

  async function buildFocusChunk(
    sha256: string,
    pageCount: number,
    from: number,
    to: number
  ): Promise<ChunkInfo> {
    assertSha256(sha256)
    const valid = [pageCount, from, to].every(Number.isInteger) && from >= 1 && from <= to && to <= pageCount
    if (!valid) throw new LibraryError('io', `Invalid focus range ${from}-${to} of ${pageCount} pages`)
    const path = focusFilePath(root, sha256, from, to)
    const cached = await stat(path).then(
      (s) => (s.isFile() ? s.size : 0),
      () => 0
    )
    if (cached > 0) return { index: FOCUS_CHUNK_INDEX, startPage: from, endPage: to, path, bytes: cached }
    const grid = await ensureChunks(sha256, pageCount)
    const bytes = await writeFocusChunk(grid, from, to, path)
    return { index: FOCUS_CHUNK_INDEX, startPage: from, endPage: to, path, bytes }
  }

  return {
    importPdf,
    ensureChunks,
    buildFocusChunk,
    pageTexts,
    storedPath(sha256) {
      assertSha256(sha256)
      return storedPdfPath(root, sha256)
    },
    async deleteFiles(sha256) {
      assertSha256(sha256)
      await removeFiles(sha256)
    }
  }
}

/** Rejects options that would loop forever or produce nonsense grids; a wiring bug, so fail fast. */
function assertChunkOptions(options: ChunkOptions): void {
  if (!Number.isInteger(options.pagesPerChunk) || options.pagesPerChunk < 1) {
    throw new RangeError(`chunk.pagesPerChunk must be a positive integer, got ${options.pagesPerChunk}`)
  }
  if (!Number.isInteger(options.maxChunkBytes) || options.maxChunkBytes < 1) {
    throw new RangeError(`chunk.maxChunkBytes must be a positive integer, got ${options.maxChunkBytes}`)
  }
}
