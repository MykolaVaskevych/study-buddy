import type { ButtonHTMLAttributes } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'
import { Kbd, ariaShortcut } from './Kbd'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: IconName
  /** Shortcut hint rendered inside the button and exposed as aria-keyshortcuts. */
  shortcut?: string
  loading?: boolean
}

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-on-primary hover:bg-primary-hover',
  secondary: 'border border-rule-strong bg-sheet text-ink hover:border-graphite hover:bg-sunken',
  ghost: 'text-graphite hover:bg-sunken hover:text-ink',
  danger: 'bg-redpen text-white hover:opacity-90'
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-7 gap-1.5 px-2.5 text-sm',
  md: 'h-9 gap-2 px-3.5 text-base'
}

export const buttonClass = (variant: ButtonVariant = 'secondary', size: ButtonSize = 'md'): string =>
  cx(
    'inline-flex shrink-0 items-center justify-center rounded-md font-semibold whitespace-nowrap transition-colors duration-150 select-none disabled:pointer-events-none disabled:opacity-50',
    variants[variant],
    sizes[size]
  )

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  shortcut,
  loading = false,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={cx(buttonClass(variant, size), className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={shortcut ? ariaShortcut(shortcut) : undefined}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 14 : 16} /> : icon ? <Icon name={icon} size={16} /> : null}
      {children}
      {shortcut ? (
        <Kbd keys={shortcut} tone={variant === 'primary' || variant === 'danger' ? 'inverse' : 'default'} />
      ) : null}
    </button>
  )
}
