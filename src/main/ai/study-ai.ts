import type { LlmProvider } from '@shared/ai/provider'
import { generateCards } from './study/cards'
import { resolveOptions, type StudyAiOptions } from './study/common'
import { gradeShortAnswer } from './study/grade'
import { indexChunk } from './study/index-chunk'
import { generateQuestions } from './study/questions'
import { buildTopicMap } from './study/topic-map'
import type { StudyAi } from './types'

export type { StudyAiOptions } from './study/common'

/**
 * StudyAi over any LlmProvider. Each method lives in its own module under ./study; this only
 * binds them to the provider and the resolved options. No state is kept between calls.
 */
export function createStudyAi(provider: LlmProvider, opts: StudyAiOptions = {}): StudyAi {
  const settings = resolveOptions(opts)
  return {
    provider,
    indexChunk: (input) => indexChunk(provider, input),
    buildTopicMap: (input) => buildTopicMap(provider, input),
    generateCards: (ctx, o) => generateCards(provider, ctx, o, settings),
    generateQuestions: (ctx, o) => generateQuestions(provider, ctx, o, settings),
    gradeShortAnswer: (input) => gradeShortAnswer(provider, input)
  }
}
