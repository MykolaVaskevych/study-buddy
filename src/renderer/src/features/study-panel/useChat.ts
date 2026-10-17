import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChatMode, ChatTurn } from '@shared/domain'
import { call, subscribe } from '../../api/client'

export interface ChatMessage extends ChatTurn {
  id: string
  /** Page the message was asked from (explain actions), for the label. */
  page: number | null
  mode: ChatMode
  pending: boolean
  error: string | null
  citations: number[]
}

/** Threads survive tab switches and page changes, per book, for this app session. */
const threads = new Map<string, ChatMessage[]>()

const MODE_PROMPTS: Record<Exclude<ChatMode, 'chat'>, string> = {
  explain_simple: 'Explain this page simply',
  explain_exam: 'Model exam answer for this page',
  worked_example: 'Worked example for this page'
}

/** Streams tutor answers from main ('chat.delta' / 'chat.done') into a per-book thread. */
export function useChat(docId: string) {
  const [messages, setMessages] = useState<ChatMessage[]>(() => threads.get(docId) ?? [])
  const active = useRef<string | null>(null)

  useEffect(() => {
    setMessages(threads.get(docId) ?? [])
  }, [docId])

  const update = useCallback(
    (fn: (prev: ChatMessage[]) => ChatMessage[]) => {
      setMessages((prev) => {
        const next = fn(prev)
        threads.set(docId, next)
        return next
      })
    },
    [docId]
  )

  useEffect(() => {
    const patch = (requestId: string, fn: (m: ChatMessage) => ChatMessage): void =>
      update((prev) => prev.map((m) => (m.id === requestId ? fn(m) : m)))
    const offDelta = subscribe('chat.delta', ({ requestId, text }) =>
      patch(requestId, (m) => ({ ...m, text: m.text + text }))
    )
    const offDone = subscribe('chat.done', ({ requestId, error, citations }) => {
      if (active.current === requestId) active.current = null
      patch(requestId, (m) => ({ ...m, pending: false, error, citations }))
    })
    return () => {
      offDelta()
      offDone()
    }
  }, [update])

  const ask = useCallback(
    async (question: string, mode: ChatMode, page: number | null): Promise<void> => {
      const text = mode === 'chat' ? question.trim() : MODE_PROMPTS[mode]
      if (!text || active.current) return
      const history: ChatTurn[] = messages
        .filter((m) => !m.pending && !m.error)
        .slice(-10)
        .map((m) => ({ role: m.role, text: m.text }))
      const userMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        text,
        page,
        mode,
        pending: false,
        error: null,
        citations: []
      }
      update((prev) => [...prev, userMsg])
      try {
        const { requestId } = await call('chat.ask', { docId, page, question: text, history, mode })
        active.current = requestId
        update((prev) => [
          ...prev,
          {
            id: requestId,
            role: 'assistant',
            text: '',
            page,
            mode,
            pending: true,
            error: null,
            citations: []
          }
        ])
      } catch (err) {
        update((prev) => [
          ...prev,
          {
            id: `e-${Date.now()}`,
            role: 'assistant',
            text: '',
            page,
            mode,
            pending: false,
            error: err instanceof Error ? err.message : String(err),
            citations: []
          }
        ])
      }
    },
    [docId, messages, update]
  )

  const stop = useCallback(() => {
    if (active.current) void call('chat.cancel', { requestId: active.current })
  }, [])

  const clear = useCallback(() => update(() => []), [update])

  return { messages, ask, stop, clear, busy: messages.some((m) => m.pending) }
}
