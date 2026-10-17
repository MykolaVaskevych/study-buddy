import { useEffect, useRef } from 'react'
import { isEditableTarget } from '../../app/shortcuts'
import { readerKeyAction } from './keys'
import type { KeyContext, ReaderAction } from './keys'

function contextOf(target: EventTarget | null): KeyContext {
  if (isEditableTarget(target)) return 'editable'
  if (target instanceof Element && target.closest('[data-reader-panel]')) return 'panel'
  return 'viewer'
}

/** Window-level reader keys. The latest handler is always used without re-subscribing. */
export function useReaderKeys(onAction: (action: ReaderAction) => void): void {
  const handler = useRef(onAction)
  useEffect(() => {
    handler.current = onAction
  })
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || document.querySelector('dialog[open]')) return
      const action = readerKeyAction(e, contextOf(e.target))
      if (!action) return
      e.preventDefault()
      handler.current(action)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}
