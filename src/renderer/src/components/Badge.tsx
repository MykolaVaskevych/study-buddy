import type { ReactNode } from 'react'
import { cx } from './cx'
import { Icon } from './Icon'
import type { IconName } from './Icon'

export type BadgeTone = 'neutral' | 'marker' | 'accent' | 'redpen' | 'ok'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-sunken text-graphite',
  marker: 'bg-marker text-marker-ink',
  accent: 'bg-accent-soft text-accent',
  redpen: 'bg-redpen-soft text-redpen',
  ok: 'bg-ok-soft text-ok'
}

interface BadgeProps {
  tone?: BadgeTone
  icon?: IconName
  className?: string
  children: ReactNode
}

/** Small tag for states and signals ("Exam trap", "12 due"). Sentence case, never all caps. */
export function Badge({ tone = 'neutral', icon, className, children }: BadgeProps): React.JSX.Element {
  return (
    <span
      className={cx(
        'tabular inline-flex h-6 items-center gap-1 rounded-sm px-1.5 text-xs font-semibold whitespace-nowrap',
        tones[tone],
        className
      )}
    >
      {icon ? <Icon name={icon} size={14} /> : null}
      {children}
    </span>
  )
}
