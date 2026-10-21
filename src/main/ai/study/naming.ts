import type { LlmProvider } from '@shared/ai/provider'
import { namingOutputSchema } from '@shared/ai/schemas'
import { NAMING_SYSTEM, buildNamingUser, type NamingFile } from '../prompts/naming'
import type { NameSuggestion, WithUsage } from '../types'
import { usageRecord } from './common'

/** Names for a course and its files. Titles are trimmed and capped; files the model skipped keep their name. */
export async function suggestNames(
  provider: LlmProvider,
  input: { files: NamingFile[]; language: string; signal?: AbortSignal }
): Promise<WithUsage<NameSuggestion>> {
  const res = await provider.generate({
    task: 'naming',
    system: NAMING_SYSTEM,
    parts: [{ type: 'text', text: buildNamingUser(input) }],
    schema: namingOutputSchema,
    tier: 'fast',
    effort: 'low',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  const clean = (s: string, fallback: string): string =>
    s.replace(/\s+/g, ' ').trim().slice(0, 200) || fallback
  const byIndex = new Map(res.data.files.map((f) => [f.index, f.title]))
  return {
    value: {
      course: clean(res.data.course_name, input.files[0]?.title ?? 'Course'),
      files: input.files.map((f, i) => clean(byIndex.get(i) ?? '', f.title))
    },
    usage: [usageRecord('naming', res)]
  }
}
