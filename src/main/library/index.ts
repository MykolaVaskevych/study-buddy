import { rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { readCompleteChunkGrid } from './chunks'
import { io } from './errors'
import { readExtractCache, writeExtractCache } from './extract-cache'
import { FOCUS_CHUNK_INDEX, writeFocusChunk } from './focus'
import type { PdfJob } from './job'
import { assertSha256, chunksDir, documentDir, extractCachePath, focusFilePath, storedPdfPath } from './paths'
import { storeSourcePdf } from './store'
import {
  LibraryError,
  type ChunkInfo,
  type ChunkOptions,
  type ImportedPdf,
  type LibraryConfig,
  type PdfLibrary
} from './types'
import { DEFAULT_WORKER_TIMEOUT_MS, processPdf, type ProcessOptions } from './worker-client'

export { PAGE_STAMP_PREFIX, stampText } from './chunk-plan'
export { FOCUS_CHUNK_INDEX } from './focus'
export { hasTextLayer } from './text'

/** 10 pages keeps a chunk well inside one model call; 20 MB leaves headroom under the 32 MB API limit. */
export const DEFAULT_CHUNK_OPTIONS: ChunkOptions = { pagesPerChunk: 10, maxChunkBytes: 20 * 1024 * 1024 }

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

  async function removeFiles(sha256: string): Promise<void> {
    await io('Cannot delete library files', async () => {
      await rm(storedPdfPath(root, sha256), { force: true })
      await rm(documentDir(root, sha256), { recursive: true, force: true })
    })
  }

  async function importPdf(sourcePath: string): Promise<ImportedPdf> {
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
        extract: extract ? null : { fileName: basename(sourcePath) },
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
