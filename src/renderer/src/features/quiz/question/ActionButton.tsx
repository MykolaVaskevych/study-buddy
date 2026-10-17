import type { Ref } from 'react'
import { buttonClass, cx, Kbd, Spinner } from '../../../components'
import type { ButtonVariant } from '../../../components'
import { ariaShortcut } from '../../../components/Kbd'

interface ActionButtonProps {
  ref?: Ref<HTMLButtonElement>
  label: string
  onClick: () => void
  shortcut?: string
  variant?: ButtonVariant
  disabled?: boolean
  loading?: boolean
  className?: string
}

/**
 * The quiz's primary action. One element whose label changes (Check → Next question → See my
 * score), with a minimum width, so it never moves and keeps focus between steps.
 */
export function ActionButton({
  ref,
  label,
  onClick,
  shortcut = 'Enter',
  variant = 'primary',
  disabled = false,
  loading = false,
  className
}: ActionButtonProps): React.JSX.Element {
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      aria-keyshortcuts={ariaShortcut(shortcut)}
      className={cx(buttonClass(variant, 'md'), 'min-w-[10.5rem]', className)}
    >
      {loading ? <Spinner size={16} /> : null}
      {label}
      <Kbd keys={shortcut} tone={variant === 'primary' ? 'inverse' : 'default'} />
    </button>
  )
}
