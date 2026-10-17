import { cx } from './cx'

interface SpinnerProps {
  size?: number
  className?: string
  /** Accessible label; omit when a surrounding element already announces the busy state. */
  label?: string
}

/** For short in-place waits (button actions). Prefer Skeleton for loading content. */
export function Spinner({ size = 16, className, label }: SpinnerProps): React.JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={cx('animate-spin', className)}
      role={label ? 'status' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        fill="none"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  )
}
