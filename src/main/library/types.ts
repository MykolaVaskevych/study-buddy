import type { OutlineItem } from '@shared/domain'

/**
 * Library module contract (owner: library/pdf work package).
 * Pure file + PDF processing. It does NOT touch the database; pipelines persist the results.
 */

export interface PageExtract {
  page: number
  label: string | null
  /** Text layer, whitespace-normalised. Empty string for image-only pages. */
  text: string
  charCount: number
  /** False when the page has (almost) no extractable text, e.g. scanned or image-only slides. */
  hasTextLayer: boolean
}

export interface ChunkInfo {
  /** 0-based position in the chunk grid. */
  index: number
  /** Absolute, inclusive page range covered by the chunk. */
  startPage: number
  endPage: number
  /** Chunk PDF on disk. Every page carries a small "SB-PAGE <n>" stamp with its absolute page number. */
  path: string
  bytes: number
}

export interface ImportedPdf {
  sha256: string
  /** Copy of the PDF inside the library directory. */
  storedPath: string
  /** PDF metadata title, else first meaningful line of page 1, else the file name. */
  title: string
  pageCount: number
  outline: OutlineItem[]
  pages: PageExtract[]
  chunks: ChunkInfo[]
}

export type LibraryErrorKind = 'not_pdf' | 'encrypted' | 'corrupt' | 'too_large' | 'io'

export class LibraryError extends Error {
  readonly kind: LibraryErrorKind
  constructor(kind: LibraryErrorKind, message: string, cause?: unknown) {
    super(message, { cause })
    this.name = 'LibraryError'
    this.kind = kind
  }
}

export interface ChunkOptions {
  /** Target pages per chunk (default 10). */
  pagesPerChunk: number
  /** Split further if a chunk file would exceed this many bytes (default 20 MB; API limit is 32 MB). */
  maxChunkBytes: number
}

export interface PdfLibrary {
  /**
   * Hash, copy into the library, extract text/outline/labels (in a worker thread) and build the chunk grid.
   * Idempotent: importing the same bytes again returns the same sha256 and reuses stored files.
   */
  importPdf(sourcePath: string): Promise<ImportedPdf>
  /** Re-create chunk files if missing (e.g. library moved). Returns the chunk grid. */
  ensureChunks(sha256: string, pageCount: number): Promise<ChunkInfo[]>
  /** Absolute path of the stored PDF for a document hash. */
  storedPath(sha256: string): string
  /** Remove stored PDF and chunks. */
  deleteFiles(sha256: string): Promise<void>
}

export interface LibraryConfig {
  /** Root directory, e.g. <userData>/library. */
  rootDir: string
  chunk: ChunkOptions
}
