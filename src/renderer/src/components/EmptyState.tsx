import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'

interface EmptyStateProps {
  icon?: IconName
  title: string
  children?: ReactNode
  /** Buttons or links that move the person forward. */
  actions?: ReactNode
  size?: 'sm' | 'md'
  className?: string
}

/** An empty or blocked screen region: says what's missing and what to do next. */
export function EmptyState({
  icon,
  title,
  children,
  actions,
  size = 'md',
  className
}: EmptyStateProps): React.JSX.Element {
  return (
    <div className={cx('flex flex-col items-start', size === 'sm' ? 'gap-2' : 'gap-3', className)}>
      {icon ? (
        <span
          className={cx(
            'inline-flex items-center justify-center rounded-lg bg-sunken text-graphite',
            size === 'sm' ? 'size-8' : 'size-10'
          )}
        >
          <Icon name={icon} size={size === 'sm' ? 16 : 20} />
        </span>
      ) : null}
      <h3 className={cx('font-serif font-semibold text-ink', size === 'sm' ? 'text-md' : 'text-lg')}>
        {title}
      </h3>
      {children ? (
        <div className={cx('max-w-[46ch] text-graphite', size === 'sm' ? 'text-sm' : 'text-base')}>
          {children}
        </div>
      ) : null}
      {actions ? <div className="mt-1 flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}
