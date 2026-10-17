import { useEffect, useRef, useState } from 'react'
import { Button, EmptyState, Markdown, Spinner, cx } from '../../components'
import type { StudyTabProps } from './tabs'
import { useChat } from './useChat'

/**
 * Tutor chat for the open book. Answers stream in and cite pages as [p. N] (buttons that jump the
 * reader). The explain actions work on the page being read.
 */
export function ChatTab({ docId, page, onCitation }: StudyTabProps): React.JSX.Element {
  const { messages, ask, stop, clear, busy } = useChat(docId)
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [messages])

  const send = (): void => {
    if (!draft.trim() || busy) return
    void ask(draft, 'chat', page)
    setDraft('')
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap gap-1.5 border-b border-rule px-4 py-2.5">
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void ask('', 'explain_simple', page)}
        >
          Explain simply
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void ask('', 'explain_exam', page)}
        >
          Exam answer
        </Button>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() => void ask('', 'worked_example', page)}
        >
          Worked example
        </Button>
        {messages.length > 0 && (
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={clear}>
            Clear
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 ? (
          <EmptyState icon="chat" title="Ask about your notes">
            Answers use your book and cite pages like [p. {page}], which jump straight there. Or pick an
            explain action for page {page}.
          </EmptyState>
        ) : (
          <ol className="flex flex-col gap-4">
            {messages.map((m) => (
              <li key={m.id} className={cx('flex flex-col', m.role === 'user' ? 'items-end' : 'items-start')}>
                {m.role === 'user' ? (
                  <div className="max-w-[90%] rounded-lg bg-sunken px-3 py-2 text-[0.95rem]">
                    {m.text}
                    {m.mode !== 'chat' && m.page !== null && (
                      <span className="ml-1.5 text-sm text-graphite">(p. {m.page})</span>
                    )}
                  </div>
                ) : (
                  <div className="w-full text-[0.95rem] leading-relaxed">
                    {m.text && <Markdown onCitation={onCitation}>{m.text}</Markdown>}
                    {m.pending && !m.text && (
                      <span className="inline-flex items-center gap-2 text-graphite">
                        <Spinner size={14} /> Reading your pages…
                      </span>
                    )}
                    {m.error && <p className="mt-1 text-sm text-redpen">{m.error}</p>}
                  </div>
                )}
              </li>
            ))}
          </ol>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="flex items-end gap-2 border-t border-rule px-4 py-3"
        onSubmit={(e) => {
          e.preventDefault()
          send()
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          Ask a question
        </label>
        <textarea
          id="chat-input"
          rows={2}
          value={draft}
          placeholder="Ask about this book… (Enter to send)"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Keep reader/panel shortcuts from firing while typing.
            e.stopPropagation()
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send()
            }
          }}
          className="min-h-[2.75rem] flex-1 resize-none rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[0.95rem] outline-none focus:border-accent"
        />
        {busy ? (
          <Button type="button" variant="secondary" onClick={stop}>
            Stop
          </Button>
        ) : (
          <Button type="submit" variant="primary" disabled={!draft.trim()}>
            Ask
          </Button>
        )}
      </form>
    </div>
  )
}
