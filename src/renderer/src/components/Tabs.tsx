import { useId, useRef } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { ariaShortcut } from './Kbd'
import { Tooltip } from './Tooltip'

export interface TabItem {
  id: string
  label: string
  icon?: IconName
  shortcut?: string
}

interface TabsProps {
  /** Accessible name of the tab list. */
  label: string
  items: readonly TabItem[]
  value: string
  onValueChange: (id: string) => void
  /** Content of the active tab. */
  children: ReactNode
  className?: string
  panelClassName?: string
}

/**
 * WAI-ARIA tabs with roving focus (←/→, Home/End). Only the active panel is rendered, so
 * inactive tabs cost nothing.
 */
export function Tabs({
  label,
  items,
  value,
  onValueChange,
  children,
  className,
  panelClassName
}: TabsProps): React.JSX.Element {
  const base = useId()
  const refs = useRef(new Map<string, HTMLButtonElement>())
  const tabId = (id: string): string => `${base}-tab-${id}`
  const panelId = `${base}-panel`

  const focusAt = (index: number): void => {
    const item = items[(index + items.length) % items.length]
    if (!item) return
    onValueChange(item.id)
    refs.current.get(item.id)?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    const current = items.findIndex((t) => t.id === value)
    if (e.key === 'ArrowRight') focusAt(current + 1)
    else if (e.key === 'ArrowLeft') focusAt(current - 1)
    else if (e.key === 'Home') focusAt(0)
    else if (e.key === 'End') focusAt(items.length - 1)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  return (
    <div className={cx('flex min-h-0 flex-col', className)}>
      <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className="flex gap-1 px-3">
        {items.map((item) => {
          const selected = item.id === value
          const button = (
            <button
              key={item.id}
              ref={(el) => {
                if (el) refs.current.set(item.id, el)
                else refs.current.delete(item.id)
              }}
              id={tabId(item.id)}
              role="tab"
              type="button"
              aria-selected={selected}
              aria-controls={panelId}
              aria-keyshortcuts={item.shortcut ? ariaShortcut(item.shortcut) : undefined}
              tabIndex={selected ? 0 : -1}
              onClick={() => onValueChange(item.id)}
              className={cx(
                'relative inline-flex h-10 items-center gap-1.5 px-2 text-sm font-semibold transition-colors',
                selected ? 'text-ink' : 'text-graphite hover:text-ink'
              )}
            >
              {item.icon ? <Icon name={item.icon} size={16} /> : null}
              {item.label}
              <span
                aria-hidden
                className={cx(
                  'absolute inset-x-1 -bottom-px h-[3px] rounded-full transition-colors',
                  selected ? 'bg-accent' : 'bg-transparent'
                )}
              />
            </button>
          )
          return item.shortcut ? (
            <Tooltip key={item.id} label={item.label} shortcut={item.shortcut}>
              {button}
            </Tooltip>
          ) : (
            button
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(value)}
        className={cx('min-h-0 flex-1 border-t border-rule', panelClassName)}
      >
        {children}
      </div>
    </div>
  )
}
