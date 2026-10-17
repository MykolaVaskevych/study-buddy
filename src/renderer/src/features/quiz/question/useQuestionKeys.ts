import { useEffect, useRef } from 'react'
import { isEditableTarget } from '../../../app/shortcuts'
import { questionKeyAction } from './keys'
import type { QuestionKeyContext } from './keys'

export interface QuestionKeyHandlers extends Omit<QuestionKeyContext, 'onControl'> {
  onChoice: (index: number) => void
  onEnter: () => void
  onReport: () => void
}

const isControl = (target: EventTarget | null): boolean =>
  target instanceof Element && target.closest('button, a[href], summary, select') !== null

/**
 * Window-level answer keys. Listens in the capture phase so it runs before the reader's keymap
 * (where digits switch study tabs) and marks handled events with preventDefault, which the
 * reader and the global shortcuts respect.
 */
export function useQuestionKeys(handlers: QuestionKeyHandlers, enabled = true): void {
  const latest = useRef(handlers)
  useEffect(() => {
    latest.current = handlers
  })
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || e.repeat || isEditableTarget(e.target)) return
      if (document.querySelector('dialog[open]')) return
      const h = latest.current
      const action = questionKeyAction(e, { ...h, onControl: isControl(e.target) })
      if (!action) return
      e.preventDefault()
      if (action.type === 'choice') h.onChoice(action.index)
      else if (action.type === 'enter') h.onEnter()
      else if (action.type === 'report') h.onReport()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [enabled])
}
