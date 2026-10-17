import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import {
  PDFDict,
  PDFDocument,
  PDFName,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFObject,
  type PDFPage
} from 'pdf-lib'
import { z } from 'zod'
import {
  STAMP_STYLE,
  halveRange,
  isTiling,
  planChunkRanges,
  stampPlacement,
  stampText,
  type PageRange
} from './chunk-plan'
import { asLibraryError, io, isNodeIoError } from './errors'
import { chunkFilePath, chunkManifestPath, writeFileAtomic } from './paths'
import { LibraryError, type ChunkInfo, type ChunkOptions } from './types'

/**
 * Chunk grid: small stamped PDFs the AI index pass reads instead of the whole document. Built with
 * pdf-lib (page copies keep the original vector content and fonts) and described by a manifest, so a
 * complete grid is verified with a few `stat` calls and a missing file is rebuilt alone.
 */

export interface ChunkJob {
  /** Directory of the chunk files (`<root>/<sha>/chunks`). */
  dir: string
  options: ChunkOptions
  /** Page count already known from extraction or the database; a mismatch means a different file. */
  expectedPageCount: number | null
}

const MANIFEST_VERSION = 1

const manifestSchema = z.strictObject({
  version: z.literal(MANIFEST_VERSION),
  pageCount: z.number().int().positive(),
  pagesPerChunk: z.number().int().positive(),
  maxChunkBytes: z.number().int().positive(),
  chunks: z.array(
    z.strictObject({
      startPage: z.number().int().positive(),
      endPage: z.number().int().positive(),
      bytes: z.number().int().nonnegative()
    })
  )
})

type ChunkManifest = z.infer<typeof manifestSchema>

/**
 * Reads the manifest if it describes a grid for this page count and these options; otherwise null,
 * which means the grid has to be rebuilt from scratch.
 */
export async function readChunkManifest(
  dir: string,
  pageCount: number,
  options: ChunkOptions
): Promise<ChunkManifest | null> {
  try {
    const manifest = manifestSchema.parse(JSON.parse(await readFile(chunkManifestPath(dir), 'utf8')))
    const matches =
      manifest.pageCount === pageCount &&
      manifest.pagesPerChunk === options.pagesPerChunk &&
      manifest.maxChunkBytes === options.maxChunkBytes &&
      isTiling(manifest.chunks, pageCount)
    return matches ? manifest : null
  } catch {
    return null
  }
}

/** Chunk infos for every manifest entry whose file exists with the recorded size. */
async function presentChunks(dir: string, manifest: ChunkManifest): Promise<(ChunkInfo | null)[]> {
  return Promise.all(
    manifest.chunks.map(async (entry, index) => {
      const path = chunkFilePath(dir, index)
      const size = await stat(path).then(
        (s) => (s.isFile() ? s.size : -1),
        () => -1
      )
      return size === entry.bytes ? { index, ...entry, path } : null
    })
  )
}

/**
 * Cheap check used before spawning a worker: the full grid when the manifest matches and every file is
 * present and intact, else null.
 */
export async function readCompleteChunkGrid(
  dir: string,
  pageCount: number,
  options: ChunkOptions
): Promise<ChunkInfo[] | null> {
  const manifest = await readChunkManifest(dir, pageCount, options)
  if (!manifest) return null
  const chunks = await presentChunks(dir, manifest)
  return chunks.every((c) => c !== null) ? chunks.filter((c) => c !== null) : null
}

/**
 * Makes sure the chunk grid of `pdfPath` exists in `job.dir` and returns it. With a matching manifest
 * only missing or damaged files are rebuilt; otherwise the whole grid is rebuilt. Idempotent.
 */
export async function ensureChunkFiles(pdfPath: string, job: ChunkJob): Promise<ChunkInfo[]> {
  const source = await loadSourcePdf(pdfPath)
  const pageCount = source.getPageCount()
  if (pageCount < 1) throw new LibraryError('corrupt', 'The PDF has no pages')
  if (job.expectedPageCount !== null && job.expectedPageCount !== pageCount) {
    throw new LibraryError(
      'corrupt',
      `Page count mismatch: expected ${job.expectedPageCount}, the PDF page tree has ${pageCount}`
    )
  }
  detachCrossPageReferences(source)
  await io('Cannot create the chunk directory', () => mkdir(job.dir, { recursive: true }))
  const manifest = await readChunkManifest(job.dir, pageCount, job.options)
  try {
    return manifest
      ? await repairGrid(source, job.dir, manifest)
      : await rebuildGrid(source, job.dir, pageCount, job.options)
  } catch (err) {
    throw asLibraryError(err, isNodeIoError(err) ? 'io' : 'corrupt', 'Could not build chunk PDFs')
  }
}

/**
 * Loads the source for page copying and refuses any encrypted file (even owner-password-only ones that
 * pdf.js opens): pdf-lib cannot decrypt, and copying still-encrypted streams yields unreadable chunks.
 * The check uses `isEncrypted` rather than `ignoreEncryption: false`, because pdf-lib's ES5-compiled
 * EncryptedPDFError fails `instanceof` and could only be told apart from parse errors by its message.
 */
async function loadSourcePdf(pdfPath: string): Promise<PDFDocument> {
  const bytes = await io(`Cannot read ${pdfPath}`, () => readFile(pdfPath))
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false }).catch(
    (err: unknown) => {
      throw asLibraryError(err, 'corrupt', 'The PDF is damaged or not a valid PDF')
    }
  )
  if (doc.isEncrypted)
    throw new LibraryError('encrypted', 'The PDF is encrypted; chunks cannot be built from it')
  return doc
}

/** Annotation keys that can point at other pages (directly or through actions and form fields). */
const CROSS_PAGE_ANNOT_KEYS = ['P', 'Dest', 'A', 'AA', 'Parent'].map((key) => PDFName.of(key))

/**
 * pdf-lib's copier follows every reference, and only drops the copied page's own /Parent. A link to
 * another page, or an annotation's /P back-pointer, would pull that page, its /Parent and so the whole
 * page tree into every chunk. Link annotations are useless in a chunk and are removed; other annotations
 * keep their appearance but lose their page and action references. Article beads (/B) go too.
 * This mutates only the in-memory source, which is never saved.
 */
export function detachCrossPageReferences(doc: PDFDocument): void {
  const link = PDFName.of('Link')
  for (const page of doc.getPages()) {
    page.node.delete(PDFName.of('B'))
    const annots = page.node.Annots()
    if (!annots) continue
    const kept: PDFObject[] = []
    for (let i = 0; i < annots.size(); i++) {
      const annot = annots.lookup(i)
      if (!(annot instanceof PDFDict) || annot.get(PDFName.of('Subtype')) === link) continue
      for (const key of CROSS_PAGE_ANNOT_KEYS) annot.delete(key)
      kept.push(annots.get(i))
    }
    if (kept.length > 0) page.node.set(PDFName.Annots, doc.context.obj(kept))
    else page.node.delete(PDFName.Annots)
  }
}

async function rebuildGrid(
  source: PDFDocument,
  dir: string,
  pageCount: number,
  options: ChunkOptions
): Promise<ChunkInfo[]> {
  // Drop the old manifest first so a crash mid-rebuild can never pair it with new files.
  await rm(chunkManifestPath(dir), { force: true })
  const chunks: ChunkInfo[] = []
  for (const range of planChunkRanges(pageCount, options.pagesPerChunk)) {
    for await (const piece of renderWithinLimit(source, range, options.maxChunkBytes)) {
      const index = chunks.length
      const path = chunkFilePath(dir, index)
      await writeFileAtomic(path, piece.bytes)
      chunks.push({ index, ...piece.range, path, bytes: piece.bytes.length })
    }
  }
  await removeStaleChunks(dir, chunks.length)
  await writeManifest(dir, { pageCount, ...options }, chunks)
  return chunks
}

async function repairGrid(source: PDFDocument, dir: string, manifest: ChunkManifest): Promise<ChunkInfo[]> {
  const present = await presentChunks(dir, manifest)
  let repaired = false
  const chunks: ChunkInfo[] = []
  for (const [index, entry] of manifest.chunks.entries()) {
    const existing = present[index]
    if (existing) {
      chunks.push(existing)
      continue
    }
    // The grid (including earlier size splits) is fixed by the manifest, so the range is rebuilt as is.
    const bytes = await renderChunk(source, entry)
    const path = chunkFilePath(dir, index)
    await writeFileAtomic(path, bytes)
    chunks.push({ index, startPage: entry.startPage, endPage: entry.endPage, path, bytes: bytes.length })
    repaired = true
  }
  // Record new sizes so the next cheap check accepts the rebuilt files.
  if (repaired) await writeManifest(dir, manifest, chunks)
  return chunks
}

/**
 * Renders a range, halving it recursively while the file exceeds `maxBytes`. A single page above the
 * limit is kept as is: it cannot be split further, and consumers see its size in `ChunkInfo.bytes`.
 */
async function* renderWithinLimit(
  source: PDFDocument,
  range: PageRange,
  maxBytes: number
): AsyncGenerator<{ range: PageRange; bytes: Uint8Array }> {
  const bytes = await renderChunk(source, range)
  const halves = bytes.length > maxBytes ? halveRange(range) : null
  if (!halves) {
    yield { range, bytes }
    return
  }
  yield* renderWithinLimit(source, halves[0], maxBytes)
  yield* renderWithinLimit(source, halves[1], maxBytes)
}

/** Copies a page range into a new PDF and stamps each page with its absolute page number. */
export async function renderChunk(source: PDFDocument, range: PageRange): Promise<Uint8Array> {
  // updateMetadata: false keeps output deterministic (no timestamps), so sizes are stable across rebuilds.
  const chunk = await PDFDocument.create({ updateMetadata: false })
  const font = await chunk.embedFont(StandardFonts.Helvetica)
  const indices = Array.from(
    { length: range.endPage - range.startPage + 1 },
    (_, i) => range.startPage - 1 + i
  )
  const pages = await chunk.copyPages(source, indices)
  pages.forEach((page, i) => {
    chunk.addPage(page)
    stampPage(page, font, range.startPage + i)
  })
  return chunk.save()
}

function stampPage(page: PDFPage, font: PDFFont, absolutePage: number): void {
  const text = stampText(absolutePage)
  const width = font.widthOfTextAtSize(text, STAMP_STYLE.fontSize)
  const at = stampPlacement(page.getCropBox(), page.getRotation().angle, width, STAMP_STYLE.inset)
  // pdf-lib wraps the existing content in q/Q before appending, so a CTM left over by the page's own
  // content stream cannot move or scale the stamp.
  page.drawText(text, {
    x: at.x,
    y: at.y,
    size: STAMP_STYLE.fontSize,
    font,
    color: rgb(STAMP_STYLE.grey, STAMP_STYLE.grey, STAMP_STYLE.grey),
    rotate: degrees(at.rotate)
  })
}

/** Removes numbered chunk files beyond the current grid, left over from an older, larger grid. */
async function removeStaleChunks(dir: string, count: number): Promise<void> {
  const names = await readdir(dir)
  await Promise.all(
    names
      .filter((name) => /^\d+\.pdf$/.test(name) && Number.parseInt(name, 10) >= count)
      .map((name) => rm(join(dir, name), { force: true }))
  )
}

async function writeManifest(
  dir: string,
  grid: { pageCount: number; pagesPerChunk: number; maxChunkBytes: number },
  chunks: readonly ChunkInfo[]
): Promise<void> {
  const manifest: ChunkManifest = {
    version: MANIFEST_VERSION,
    pageCount: grid.pageCount,
    pagesPerChunk: grid.pagesPerChunk,
    maxChunkBytes: grid.maxChunkBytes,
    chunks: chunks.map(({ startPage, endPage, bytes }) => ({ startPage, endPage, bytes }))
  }
  await writeFileAtomic(chunkManifestPath(dir), `${JSON.stringify(manifest, null, 2)}\n`)
}
