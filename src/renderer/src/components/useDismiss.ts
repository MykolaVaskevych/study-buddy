import { useEffect } from 'react'
import type { RefObject } from 'react'

/** Closes a popover on Escape or a press outside `ref`. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) close()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, ref, close])
}
