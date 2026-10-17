import { z } from 'zod'
import { ensureChunkFiles, type ChunkJob } from './chunks'
import { deserializeLibraryError, type SerializedLibraryError } from './errors'
import { extractPdfFile } from './extract'
import { chunkInfoSchema, chunkOptionsSchema, pdfExtractSchema, type PdfExtract } from './schemas'
import { LibraryError, type ChunkInfo } from './types'

/**
 * One unit of CPU-heavy PDF work. Import runs extraction and chunking in a single job so the worker is
 * spawned and pdf.js / pdf-lib are loaded once; `ensureChunks` runs a chunks-only job.
 */
export interface PdfJob {
  /** The stored library copy, never the user's original. */
  pdfPath: string
  /** Extract text, labels, outline and title. `fileName` is the title of last resort. Null to skip. */
  extract: { fileName: string } | null
  /** Create or repair the chunk grid. Null to skip. */
  chunks: ChunkJob | null
}

export interface PdfJobResult {
  extract: PdfExtract | null
  chunks: ChunkInfo[] | null
}

/**
 * Runs a job in the current thread. Extraction goes first: pdf.js gives the clearer errors (password,
 * damaged file), and its page count is then checked against pdf-lib's so chunks match extracted pages.
 */
export async function runPdfJob(job: PdfJob): Promise<PdfJobResult> {
  const extract = job.extract ? await extractPdfFile(job.pdfPath, job.extract.fileName) : null
  const chunks = job.chunks
    ? await ensureChunkFiles(job.pdfPath, {
        ...job.chunks,
        expectedPageCount: job.chunks.expectedPageCount ?? extract?.pageCount ?? null
      })
    : null
  return { extract, chunks }
}

export const pdfJobSchema: z.ZodType<PdfJob> = z.strictObject({
  pdfPath: z.string().min(1),
  extract: z.strictObject({ fileName: z.string() }).nullable(),
  chunks: z
    .strictObject({
      dir: z.string().min(1),
      options: chunkOptionsSchema,
      expectedPageCount: z.number().int().positive().nullable()
    })
    .nullable()
})

const pdfJobResultSchema: z.ZodType<PdfJobResult> = z.strictObject({
  extract: pdfExtractSchema.nullable(),
  chunks: z.array(chunkInfoSchema).nullable()
})

/** The single message a PDF worker posts back. */
export type WorkerReply = { ok: true; result: PdfJobResult } | { ok: false; error: SerializedLibraryError }

/** Validates a worker reply and turns failures into the LibraryError they describe. */
export function unwrapWorkerReply(reply: unknown): PdfJobResult {
  if (typeof reply === 'object' && reply !== null && 'ok' in reply) {
    if (reply.ok === true && 'result' in reply) {
      const parsed = pdfJobResultSchema.safeParse(reply.result)
      if (parsed.success) return parsed.data
      throw new LibraryError('io', `PDF worker sent an invalid result: ${parsed.error.message}`)
    }
    if (reply.ok === false && 'error' in reply) throw deserializeLibraryError(reply.error)
  }
  throw new LibraryError('io', 'PDF worker sent an unexpected message')
}
