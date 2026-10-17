import { randomUUID } from 'node:crypto'
import type { ChatTurn, DocId } from '@shared/domain'
import { citedPages } from '../ai/prompts/chat'
import type { ChatContextPage } from '../ai/types'
import { messageOf } from './errors'
import type { Material } from './material'
import { requireDoc } from './scope'
import type { Handlers, PipelineDeps } from './types'
import type { UsageLedger } from './usage'

/** Pages sent as chat context: the current page's neighbourhood plus the best search hits. */
const MAX_CONTEXT_PAGES = 8
const SEARCH_HITS = 6

/**
 * Tutor chat and explain actions. Stateless: the renderer keeps the thread and sends recent turns.
 * Answers stream as 'chat.delta' events and end with one 'chat.done' carrying the cited pages.
 */
export function createChat(
  deps: Pick<PipelineDeps, 'db' | 'library' | 'aiFor' | 'emit'>,
  services: { ledger: UsageLedger; material: Material }
): { handlers: Pick<Handlers, 'chat.ask' | 'chat.cancel'> } {
  const { db } = deps
  const running = new Map<string, AbortController>()

  function contextPages(docId: DocId, page: number | null, question: string): ChatContextPage[] {
    const doc = requireDoc(db, docId)
    const wanted: number[] = []
    if (page !== null)
      for (const p of [page, page - 1, page + 1]) if (p >= 1 && p <= doc.pageCount) wanted.push(p)
    if (question.trim().length > 2) {
      try {
        for (const hit of db.pages.search(question, docId, SEARCH_HITS)) wanted.push(hit.page)
      } catch {
        // A query FTS cannot use still gets the current page as context.
      }
    }
    return [...new Set(wanted)].slice(0, MAX_CONTEXT_PAGES).map((p) => {
      const notes = db.pages.notes(docId, p)
      return {
        page: p,
        text: db.pages.text(docId, p),
        summary: notes?.summary ?? null,
        keyPoints: notes?.keyPoints ?? [],
        formulas: (notes?.formulas ?? []).map((f) => f.latex)
      }
    })
  }

  async function answer(
    requestId: string,
    input: {
      docId: DocId
      page: number | null
      question: string
      history: ChatTurn[]
      mode: Parameters<Handlers['chat.ask']>[0]['mode']
    },
    signal: AbortSignal
  ): Promise<void> {
    let text = ''
    try {
      const doc = requireDoc(db, input.docId)
      const ai = deps.aiFor()
      services.ledger.assertBudget(ai.provider.id)
      const focus =
        input.page === null
          ? null
          : await deps.library.buildFocusChunk(doc.sha256, doc.pageCount, input.page, input.page)
      for await (const event of ai.chat({
        mode: input.mode,
        question: input.question,
        history: input.history,
        pages: contextPages(input.docId, input.page, input.question),
        focus,
        language: services.material.language(doc),
        signal
      })) {
        if (event.type === 'text') {
          text += event.text
          deps.emit('chat.delta', { requestId, text: event.text })
        } else {
          services.ledger.record(input.docId, ai.provider.id, [event.usage])
        }
      }
      deps.emit('chat.done', { requestId, error: null, citations: citedPages(text) })
    } catch (err) {
      const error = signal.aborted ? 'Stopped.' : messageOf(err)
      deps.emit('chat.done', { requestId, error, citations: citedPages(text) })
    } finally {
      running.delete(requestId)
    }
  }

  return {
    handlers: {
      async 'chat.ask'(input) {
        requireDoc(db, input.docId)
        const requestId = randomUUID()
        const controller = new AbortController()
        running.set(requestId, controller)
        void answer(requestId, input, controller.signal)
        return { requestId }
      },
      async 'chat.cancel'({ requestId }) {
        running.get(requestId)?.abort()
        return { ok: true }
      }
    }
  }
}
