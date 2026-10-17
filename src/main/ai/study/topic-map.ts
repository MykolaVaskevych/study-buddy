import type { OutlineItem } from '@shared/domain'
import type { LlmProvider } from '@shared/ai/provider'
import { topicMapOutputSchema } from '@shared/ai/schemas'
import { TOPIC_MAP_SYSTEM, buildTopicMapUser } from '../prompts/topic-map'
import { normalizeTopics } from '../quality/topics'
import type { PageDigest, TopicDraft, WithUsage } from '../types'
import { usageRecord } from './common'

function outlinePages(items: readonly OutlineItem[]): number[] {
  return items.flatMap((i) => [...(i.page === null ? [] : [i.page]), ...outlinePages(i.children)])
}

/**
 * Course map on the smart tier from digests and outline (text only). The document's page span
 * is taken from what the inputs mention, since the contract carries no page count. Without any
 * digest or outline there is nothing to map and no call is made.
 */
export async function buildTopicMap(
  provider: LlmProvider,
  input: {
    title: string
    outline: OutlineItem[]
    pages: PageDigest[]
    language: string
    signal?: AbortSignal
  }
): Promise<WithUsage<TopicDraft[]>> {
  const known = [...input.pages.map((p) => p.page), ...outlinePages(input.outline)].filter(
    (p) => Number.isInteger(p) && p >= 1
  )
  if (known.length === 0) return { value: [], usage: [] }
  const doc = { firstPage: 1, lastPage: Math.max(...known) }
  const res = await provider.generate({
    task: 'topics',
    system: TOPIC_MAP_SYSTEM,
    parts: [{ type: 'text', text: buildTopicMapUser({ ...input, ...doc }) }],
    schema: topicMapOutputSchema,
    tier: 'smart',
    effort: 'medium',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  return { value: normalizeTopics(res.data.topics, doc), usage: [usageRecord('topics', res)] }
}
