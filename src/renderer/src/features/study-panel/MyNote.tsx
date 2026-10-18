import { useEffect, useRef, useState } from 'react'
import { useAnnotations, useDeleteAnnotation, useSaveAnnotation } from '../../api/hooks'

const SAVE_DELAY_MS = 700

/** The student's own note for the current page; saves as you type. */
export function MyNote({ docId, page }: { docId: string; page: number }): React.JSX.Element {
  const annotations = useAnnotations(docId)
  // mutate functions are stable across renders, so they are safe effect dependencies.
  const { mutate: saveNote } = useSaveAnnotation()
  const { mutate: removeNote } = useDeleteAnnotation()
  const stored = (annotations.data ?? []).find((a) => a.kind === 'note' && a.page === page)?.text ?? ''
  const [text, setText] = useState(stored)
  const dirty = useRef(false)

  // A different page (or the note loading) replaces the draft, unless the user is mid-edit.
  useEffect(() => {
    if (!dirty.current) setText(stored)
  }, [stored, page])
  useEffect(() => {
    dirty.current = false
  }, [page])

  useEffect(() => {
    if (!dirty.current) return
    const timer = setTimeout(() => {
      dirty.current = false
      if (text.trim() === '') removeNote({ docId, page, kind: 'note' })
      else saveNote({ docId, page, kind: 'note', text })
    }, SAVE_DELAY_MS)
    return () => clearTimeout(timer)
  }, [text, docId, page, saveNote, removeNote])

  return (
    <section className="mb-6" data-tour="my-note">
      <label htmlFor={`my-note-${page}`} className="mb-1.5 block text-sm font-semibold text-graphite">
        My notes for this page
      </label>
      <textarea
        id={`my-note-${page}`}
        rows={3}
        value={text}
        placeholder="Your own notes, questions, mnemonics… (saved automatically)"
        onChange={(e) => {
          dirty.current = true
          setText(e.target.value)
        }}
        onKeyDown={(e) => e.stopPropagation()}
        className="w-full resize-y rounded-md border border-rule-strong bg-sheet px-3 py-2 text-[0.95rem] outline-none focus:border-accent"
      />
    </section>
  )
}
