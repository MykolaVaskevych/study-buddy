import type { LlmProvider } from '@shared/ai/provider'
import { lessonOutputSchema } from '@shared/ai/schemas'
import type { LessonExercise, LessonSection } from '@shared/domain'
import { chunkParts } from '../prompts/common'
import { LESSON_SYSTEM, buildLessonUser } from '../prompts/lesson'
import type { GenerationContext, WithUsage } from '../types'
import { selectChunks, usageRecord, type ResolvedOptions } from './common'

const MAX_SECTIONS = 8
const MAX_EXERCISES = 6

/** One study-book chapter for a topic; empty sections and unanswered exercises are dropped. */
export async function writeLesson(
  provider: LlmProvider,
  ctx: GenerationContext,
  topic: { title: string; objectives: string[] },
  settings: ResolvedOptions
): Promise<WithUsage<{ sections: LessonSection[]; exercises: LessonExercise[] }>> {
  const chunks = selectChunks(ctx.chunks, ctx.pageFrom, ctx.pageTo, settings)
  const res = await provider.generate({
    task: 'lesson',
    system: LESSON_SYSTEM,
    parts: [...chunkParts(chunks), { type: 'text', text: buildLessonUser(ctx, topic) }],
    schema: lessonOutputSchema,
    tier: 'smart',
    effort: 'medium',
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal })
  })
  const sections = res.data.sections
    .map((s) => ({ title: s.title.trim(), markdown: s.markdown.trim() }))
    .filter((s) => s.title !== '' && s.markdown !== '')
    .slice(0, MAX_SECTIONS)
  const exercises = res.data.exercises
    .map((e) => ({ question: e.question.trim(), answer: e.answer.trim() }))
    .filter((e) => e.question !== '' && e.answer !== '')
    .slice(0, MAX_EXERCISES)
  return { value: { sections, exercises }, usage: [usageRecord('lesson', res)] }
}
