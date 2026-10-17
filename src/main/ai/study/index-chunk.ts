import type { LlmProvider } from '@shared/ai/provider'
import { indexChunkOutputSchema } from '@shared/ai/schemas'
import type { ChunkInfo } from '../../library/types'
import { chunkParts } from '../prompts/common'
import { INDEX_SYSTEM, buildIndexUser } from '../prompts/index-chunk'
import { normalizeIndexedPages, normalizeLanguage } from '../quality/pages'
import type { IndexedPage, PageTextLookup, WithUsage } from '../types'
import { usageRecord } from './common'

/**
 * Index pass for one chunk on the fast tier. Low effort: the pass extracts and summarises,
 * it does not reason, and it runs over every page of every document.
 */
export async function indexChunk(
  provider: LlmProvider,
  input: { chunk: ChunkInfo; pageText: PageTextLookup; signal?: AbortSignal }
): Promise<WithUsage<{ language: string; pages: IndexedPage[]; missingPages: number[] }>> {
  const { chunk } = input
  const res = await provider.generate({
    task: 'index',
    system: INDEX_SYSTEM,
    parts: [...chunkParts([chunk]), { type: 'text', text: buildIndexUser(chunk, input.pageText) }],
    schema: indexChunkOutputSchema,
    tier: 'fast',
    effort: 'low',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const { pages, missingPages } = normalizeIndexedPages(res.data.pages, chunk.startPage, chunk.endPage)
  return {
    value: { language: normalizeLanguage(res.data.language), pages, missingPages },
    usage: [usageRecord('index', res)]
  }
}
