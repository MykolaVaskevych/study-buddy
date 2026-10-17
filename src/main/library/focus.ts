import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { asLibraryError, io, isNodeIoError } from './errors'
import { writeFileAtomic } from './paths'
import { LibraryError, type ChunkInfo } from './types'

/**
 * Focus chunks: a few stamped pages cut out of the chunk grid. A page check or a one-page card set only
 * needs the page itself plus a neighbour for context, so sending the whole 10-page chunk would pay for
 * pages the model is told to ignore. Pages are copied from the chunk files rather than the source PDF:
 * chunk pages already carry their "SB-PAGE <n>" stamp and have no cross-page references, so a plain copy
 * keeps both. Runs on the calling thread: it loads at most a couple of small chunk files.
 */

/** `ChunkInfo.index` of a focus chunk: it is not a position in the grid. */
export const FOCUS_CHUNK_INDEX = -1

/** Chunks of the grid overlapping from..to, in page order. Throws when the grid leaves a gap. */
export function chunksCovering(grid: readonly ChunkInfo[], from: number, to: number): ChunkInfo[] {
  const selected = grid
    .filter((c) => c.endPage >= from && c.startPage <= to)
    .sort((a, b) => a.startPage - b.startPage)
  let next = from
  for (const c of selected) {
    if (c.startPage > next) break
    next = Math.max(next, c.endPage + 1)
  }
  if (next <= to) throw new LibraryError('io', `The chunk grid does not cover page ${next}`)
  return selected
}

/**
 * Writes pages from..to (absolute, inclusive) of the grid into `path` and returns the file size.
 * The write is atomic, so a cached focus file is either complete or absent.
 */
export async function writeFocusChunk(
  grid: readonly ChunkInfo[],
  from: number,
  to: number,
  path: string
): Promise<number> {
  try {
    const out = await PDFDocument.create({ updateMetadata: false })
    for (const chunk of chunksCovering(grid, from, to)) {
      const bytes = await io(`Cannot read chunk ${chunk.index}`, () => readFile(chunk.path))
      const source = await PDFDocument.load(bytes, { updateMetadata: false })
      const lo = Math.max(from, chunk.startPage)
      const hi = Math.min(to, chunk.endPage)
      const indices = Array.from({ length: hi - lo + 1 }, (_, i) => lo - chunk.startPage + i)
      for (const page of await out.copyPages(source, indices)) out.addPage(page)
    }
    if (out.getPageCount() !== to - from + 1) {
      throw new LibraryError('corrupt', `Focus chunk ${from}-${to} has ${out.getPageCount()} pages`)
    }
    const bytes = await out.save()
    await mkdir(dirname(path), { recursive: true })
    await writeFileAtomic(path, bytes)
    return bytes.length
  } catch (err) {
    throw asLibraryError(
      err,
      isNodeIoError(err) ? 'io' : 'corrupt',
      `Could not build focus pages ${from}-${to}`
    )
  }
}
