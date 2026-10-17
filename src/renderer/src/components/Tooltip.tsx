import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Kbd } from './Kbd'

type Side = 'top' | 'bottom' | 'right' | 'left'

interface TooltipProps {
  label: string
  /** Optional shortcut shown as key caps next to the label. */
  shortcut?: string
  side?: Side
  children: ReactNode
}

interface Position {
  top: number
  left: number
}

const GAP = 8
const DELAY_MS = 450

function place(rect: DOMRect, side: Side): Position {
  switch (side) {
    case 'top':
      return { top: rect.top - GAP, left: rect.left + rect.width / 2 }
    case 'bottom':
      return { top: rect.bottom + GAP, left: rect.left + rect.width / 2 }
    case 'right':
      return { top: rect.top + rect.height / 2, left: rect.right + GAP }
    case 'left':
      return { top: rect.top + rect.height / 2, left: rect.left - GAP }
  }
}

const transforms: Record<Side, string> = {
  top: 'translate(-50%, -100%)',
  bottom: 'translate(-50%, 0)',
  right: 'translate(0, -50%)',
  left: 'translate(-100%, -50%)'
}

/**
 * Hover/focus tooltip rendered in a portal so scroll containers never clip it. The trigger
 * keeps its own accessible name (aria-label); the tooltip adds the visual label + shortcut.
 */
export function Tooltip({ label, shortcut, side = 'bottom', children }: TooltipProps): React.JSX.Element {
  const id = useId()
  const anchor = useRef<HTMLSpanElement>(null)
  const timer = useRef<number | null>(null)
  const [pos, setPos] = useState<Position | null>(null)

  const show = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      const el = anchor.current
      if (el) setPos(place(el.getBoundingClientRect(), side))
    }, DELAY_MS)
  }, [side])

  const hide = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setPos(null)
  }, [])

  useEffect(() => hide, [hide])

  useEffect(() => {
    if (!pos) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') hide()
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('scroll', hide, true)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('scroll', hide, true)
    }
  }, [pos, hide])

  return (
    <span
      ref={anchor}
      className="inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocus={show}
      onBlur={hide}
      aria-describedby={pos ? id : undefined}
    >
      {children}
      {pos
        ? createPortal(
            <span
              id={id}
              role="tooltip"
              className="pointer-events-none fixed z-50 flex items-center gap-2 rounded-md bg-primary px-2 py-1 text-xs whitespace-nowrap text-on-primary shadow-pop"
              style={{ top: pos.top, left: pos.left, transform: transforms[side] }}
            >
              {label}
              {shortcut ? <Kbd keys={shortcut} tone="inverse" /> : null}
            </span>,
            document.body
          )
        : null}
    </span>
  )
}
