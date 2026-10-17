import { useRef } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import { PANE_LIMITS, useUiStore } from '../../app/uiStore'
import type { PaneSide } from '../../app/uiStore'
import { cx } from '../../components'

/** Draggable, keyboard-operable divider between a side pane and the viewer (←/→, Enter collapses). */
export function ResizeHandle({ side, label }: { side: PaneSide; label: string }): React.JSX.Element {
  const width = useUiStore((s) => s.panes[side].width)
  const setWidth = useUiStore((s) => s.setPaneWidth)
  const toggle = useUiStore((s) => s.togglePane)
  const drag = useRef<{ x: number; width: number } | null>(null)
  const sign = side === 'left' ? 1 : -1

  const onPointerDown = (e: PointerEvent<HTMLDivElement>): void => {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, width }
  }
  const onPointerMove = (e: PointerEvent<HTMLDivElement>): void => {
    if (!drag.current) return
    setWidth(side, drag.current.width + sign * (e.clientX - drag.current.x))
  }
  const onPointerUp = (): void => {
    drag.current = null
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowLeft') setWidth(side, width - sign * 24)
    else if (e.key === 'ArrowRight') setWidth(side, width + sign * 24)
    else if (e.key === 'Enter') toggle(side)
    else return
    e.preventDefault()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={PANE_LIMITS[side].min}
      aria-valuemax={PANE_LIMITS[side].max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={() => toggle(side)}
      onKeyDown={onKeyDown}
      className={cx(
        'group relative z-10 w-px shrink-0 cursor-col-resize bg-rule outline-none',
        'before:absolute before:inset-y-0 before:-left-1.5 before:w-3 before:content-[""]',
        'after:absolute after:inset-y-0 after:left-0 after:w-px after:transition-colors after:content-[""] hover:after:bg-accent focus-visible:after:w-0.5 focus-visible:after:bg-accent'
      )}
    />
  )
}
