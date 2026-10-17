import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { ariaShortcut } from './Kbd'
import { Tooltip } from './Tooltip'

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon: IconName
  /** Accessible name and tooltip text. */
  label: string
  shortcut?: string
  size?: 'sm' | 'md'
  /** Toggle buttons: rendered pressed and exposed with aria-pressed. */
  pressed?: boolean
  tooltipSide?: 'top' | 'bottom' | 'left' | 'right'
}

export function IconButton({
  icon,
  label,
  shortcut,
  size = 'md',
  pressed,
  tooltipSide = 'bottom',
  className,
  type = 'button',
  ...rest
}: IconButtonProps): React.JSX.Element {
  return (
    <Tooltip label={label} shortcut={shortcut} side={tooltipSide}>
      <button
        type={type}
        aria-label={label}
        aria-pressed={pressed}
        aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
        className={cx(
          'inline-flex shrink-0 items-center justify-center rounded-md text-graphite transition-colors duration-150 hover:bg-sunken hover:text-ink disabled:opacity-40 disabled:hover:bg-transparent',
          size === 'sm' ? 'size-7' : 'size-8',
          pressed && 'bg-sunken text-ink',
          className
        )}
        {...rest}
      >
        <Icon name={icon} size={size === 'sm' ? 16 : 18} />
      </button>
    </Tooltip>
  )
}
