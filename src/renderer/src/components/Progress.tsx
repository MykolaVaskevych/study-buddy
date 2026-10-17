import { cx } from './cx'

export type ProgressTone = 'ink' | 'accent' | 'marker' | 'ok' | 'redpen'

const fills: Record<ProgressTone, string> = {
  ink: 'bg-ink',
  accent: 'bg-accent',
  marker: 'bg-marker',
  ok: 'bg-ok',
  redpen: 'bg-redpen'
}

interface ProgressProps {
  /** 0..1; null renders an indeterminate (unknown) track. */
  value: number | null
  /** Accessible name, e.g. "Indexed pages". */
  label: string
  /** Human readable value for assistive tech, e.g. "60 of 146 pages". */
  valueText?: string
  tone?: ProgressTone
  size?: 'xs' | 'sm'
  className?: string
}

export function Progress({
  value,
  label,
  valueText,
  tone = 'ink',
  size = 'sm',
  className
}: ProgressProps): React.JSX.Element {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct ?? undefined}
      aria-valuetext={valueText}
      className={cx(
        'relative w-full overflow-hidden rounded-full bg-sunken',
        size === 'xs' ? 'h-1' : 'h-1.5',
        className
      )}
    >
      {pct === null ? (
        <div className="skeleton absolute inset-0 rounded-full" />
      ) : (
        <div
          className={cx('h-full rounded-full transition-[width] duration-500', fills[tone])}
          style={{ width: `${pct}%` }}
        />
      )}
    </div>
  )
}
