import { z } from 'zod'
import type { OutlineItem } from '@shared/domain'
import type { ChunkInfo, ChunkOptions, PageExtract } from './types'

/**
 * Data that crosses a trust boundary inside the library: the worker reply (another thread) and the
 * JSON files on disk (may be stale, truncated or hand-edited). Everything is validated on the way in.
 */

/** What extraction produces: the document part of `ImportedPdf`. */
export interface PdfExtract {
  title: string
  pageCount: number
  outline: OutlineItem[]
  pages: PageExtract[]
}

const pageNumber = z.number().int().positive()

export const outlineItemSchema: z.ZodType<OutlineItem> = z.lazy(() =>
  z.strictObject({
    title: z.string(),
    page: pageNumber.nullable(),
    children: z.array(outlineItemSchema)
  })
)

export const pageExtractSchema: z.ZodType<PageExtract> = z.strictObject({
  page: pageNumber,
  label: z.string().nullable(),
  text: z.string(),
  charCount: z.number().int().nonnegative(),
  hasTextLayer: z.boolean()
})

export const pdfExtractSchema: z.ZodType<PdfExtract> = z
  .strictObject({
    title: z.string().min(1),
    pageCount: pageNumber,
    outline: z.array(outlineItemSchema),
    pages: z.array(pageExtractSchema)
  })
  .refine((e) => e.pages.length === e.pageCount && e.pages.every((p, i) => p.page === i + 1), {
    message: 'pages must list every page in order'
  })

export const chunkInfoSchema: z.ZodType<ChunkInfo> = z.strictObject({
  index: z.number().int().nonnegative(),
  startPage: pageNumber,
  endPage: pageNumber,
  path: z.string().min(1),
  bytes: z.number().int().nonnegative()
})

export const chunkOptionsSchema: z.ZodType<ChunkOptions> = z.strictObject({
  pagesPerChunk: pageNumber,
  maxChunkBytes: pageNumber
})
