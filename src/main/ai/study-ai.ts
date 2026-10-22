import type { LlmProvider } from '@shared/ai/provider'
import { generateCards } from './study/cards'
import { resolveOptions, type StudyAiOptions } from './study/common'
import { chat } from './study/chat'
import { gradeShortAnswer } from './study/grade'
import { writeLesson } from './study/lesson'
import { indexChunk } from './study/index-chunk'
import { generateQuestions } from './study/questions'
import { suggestNames } from './study/naming'
import { portalStep } from './study/portal'
import { mapPastPaper } from './study/past-paper'
import { buildTopicMap } from './study/topic-map'
import { routeProvider } from './routing'
import type { StudyAi } from './types'

export type { StudyAiOptions } from './study/common'

/**
 * StudyAi over any LlmProvider. Each method lives in its own module under ./study; this only
 * binds them to the provider and the resolved options. No state is kept between calls.
 */
export function createStudyAi(base: LlmProvider, opts: StudyAiOptions = {}): StudyAi {
  const settings = resolveOptions(opts)
  // Every call takes the model and effort routed to its task; escalation goes to the unrouted provider.
  const provider = routeProvider(base, settings.routes)
  const strong = (task: 'cards' | 'page_check'): LlmProvider | null =>
    settings.escalate && settings.routes[task].tier === 'fast' ? base : null
  return {
    provider,
    indexChunk: (input) => indexChunk(provider, input),
    buildTopicMap: (input) => buildTopicMap(provider, input),
    generateCards: (ctx, o) => generateCards(provider, ctx, o, settings, strong('cards')),
    generateQuestions: (ctx, o) =>
      generateQuestions(provider, ctx, o, settings, o.purpose === 'page_check' ? strong('page_check') : null),
    gradeShortAnswer: (input) => gradeShortAnswer(provider, input),
    chat: (input) => chat(provider, input),
    writeLesson: (ctx, topic) => writeLesson(provider, ctx, topic, settings),
    mapPastPaper: (input) => mapPastPaper(provider, input),
    suggestNames: (input) => suggestNames(provider, input),
    portalStep: (input) => portalStep(provider, input)
  }
}
