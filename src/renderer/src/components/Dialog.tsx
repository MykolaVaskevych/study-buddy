import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { cx } from './cx'
import { IconButton } from './IconButton'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  /** Footer buttons, right aligned. */
  actions?: ReactNode
  className?: string
}

/**
 * Modal dialog on the native <dialog> element: the browser provides the focus trap, Esc to
 * close, inertness of the page behind and the top layer.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  actions,
  className
}: DialogProps): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()
  const descId = useId()

  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (open && !el.open) {
      if (typeof el.showModal === 'function') el.showModal()
      else el.setAttribute('open', '')
    } else if (!open && el.open) {
      if (typeof el.close === 'function') el.close()
      else el.removeAttribute('open')
    }
  }, [open])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => {
        e.preventDefault()
        onClose()
      }}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) onClose()
      }}
      className={cx(
        'm-auto w-[min(32rem,calc(100vw-2rem))] rounded-xl border border-rule bg-sheet p-0 text-ink shadow-pop',
        className
      )}
    >
      {open ? (
        <div className="flex flex-col gap-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-col gap-1">
              <h2 id={titleId} className="font-serif text-lg font-semibold">
                {title}
              </h2>
              {description ? (
                <p id={descId} className="text-graphite">
                  {description}
                </p>
              ) : null}
            </div>
            <IconButton icon="close" label="Close" size="sm" onClick={onClose} shortcut="Esc" />
          </div>
          {children}
          {actions ? <div className="flex justify-end gap-2">{actions}</div> : null}
        </div>
      ) : null}
    </dialog>
  )
}
