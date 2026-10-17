import { AiError, type LlmProvider, type PromptPart, type Usage } from '@shared/ai/provider'
import { CHAT_SYSTEM, buildChatUser } from '../prompts/chat'
import type { ChatEvent, ChatInput } from '../types'

/** Streams a grounded tutor answer; the caller extracts [p. N] citations from the text. */
export async function* chat(provider: LlmProvider, input: ChatInput): AsyncIterable<ChatEvent> {
  const parts: PromptPart[] = []
  if (input.focus) parts.push({ type: 'pdf', path: input.focus.path, title: `Page ${input.focus.startPage}` })
  parts.push({
    type: 'text',
    text: buildChatUser({
      mode: input.mode,
      question: input.question,
      history: input.history,
      pages: input.pages,
      hasFocus: input.focus !== null,
      language: input.language
    })
  })
  let finished: { usage: Usage; model: string } | null = null
  for await (const event of provider.stream({
    task: input.mode === 'chat' ? 'chat' : 'explain',
    system: CHAT_SYSTEM,
    parts,
    tier: 'smart',
    effort: 'low',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })) {
    if (event.type === 'text') yield event
    else finished = { usage: event.usage, model: event.model }
  }
  if (!finished) throw new AiError('truncated', 'The answer stream ended unexpectedly')
  yield {
    type: 'done',
    usage: { task: input.mode === 'chat' ? 'chat' : 'explain', model: finished.model, usage: finished.usage }
  }
}
