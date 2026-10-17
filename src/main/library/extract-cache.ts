import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import { writeFileAtomic } from './paths'
import { pdfExtractSchema, type PdfExtract } from './schemas'

/**
 * Extraction results cached next to the chunks, so re-importing the same bytes skips pdf.js entirely.
 * Bump the version whenever extraction output changes (text joining, title rules, ...) so old caches are
 * ignored and rebuilt rather than served stale.
 */
export const EXTRACT_CACHE_VERSION = 1

const cacheSchema = z.strictObject({
  version: z.literal(EXTRACT_CACHE_VERSION),
  extract: pdfExtractSchema
})

/** Returns the cached extraction, or null when it is missing, outdated or unreadable (a cache miss). */
export async function readExtractCache(path: string): Promise<PdfExtract | null> {
  try {
    const parsed = cacheSchema.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data.extract : null
  } catch {
    return null
  }
}

export async function writeExtractCache(path: string, extract: PdfExtract): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  await writeFileAtomic(path, JSON.stringify({ version: EXTRACT_CACHE_VERSION, extract }))
}
