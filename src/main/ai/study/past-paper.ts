import type { LlmProvider } from '@shared/ai/provider'
import { pastPaperOutputSchema } from '@shared/ai/schemas'
import type { ChunkInfo } from '../../library/types'
import { PAST_PAPER_SYSTEM, buildPastPaperUser } from '../prompts/past-paper'
import { chunkParts } from '../prompts/common'
import type { PastPaperAnalysis, WithUsage } from '../types'
import { usageRecord } from './common'

/** Maps a past paper to topic keys; unknown keys become null and marks are clamped to 0..100. */
export async function mapPastPaper(
  provider: LlmProvider,
  input: {
    topics: { key: string; title: string; pageStart: number; pageEnd: number }[]
    paper: ChunkInfo[]
    language: string
    signal?: AbortSignal
  }
): Promise<WithUsage<PastPaperAnalysis>> {
  const keys = new Set(input.topics.map((t) => t.key))
  const res = await provider.generate({
    task: 'past_paper',
    system: PAST_PAPER_SYSTEM,
    parts: [...chunkParts(input.paper), { type: 'text', text: buildPastPaperUser(input) }],
    schema: pastPaperOutputSchema,
    tier: 'smart',
    effort: 'medium',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const questions = res.data.questions.map((q) => ({
    summary: q.summary.trim(),
    marks: Number.isFinite(q.marks) ? Math.min(100, Math.max(0, q.marks)) : 0,
    topicKey: q.topic_key !== null && keys.has(q.topic_key) ? q.topic_key : null,
    format: q.format,
    usesFormula: q.uses_formula
  }))
  return {
    value: {
      questions,
      style: res.data.style_summary.trim(),
      formulaSheet: res.data.formula_sheet,
      examples: res.data.examples
        .map((e) => e.trim())
        .filter(Boolean)
        .slice(0, 5)
    },
    usage: [usageRecord('past_paper', res)]
  }
}
