import { cx } from './cx'

interface SkeletonProps {
  className?: string
}

/** Placeholder block shaped like the content that is loading. */
export function Skeleton({ className }: SkeletonProps): React.JSX.Element {
  return <div aria-hidden className={cx('skeleton h-4', className)} />
}

const widths = ['w-full', 'w-11/12', 'w-4/5', 'w-full', 'w-3/4', 'w-5/6', 'w-2/3']

/** A paragraph of skeleton lines with a natural ragged right edge. */
export function SkeletonText({
  lines = 3,
  className
}: {
  lines?: number
  className?: string
}): React.JSX.Element {
  return (
    <div aria-hidden className={cx('flex flex-col gap-2.5', className)}>
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={cx('skeleton h-3.5', i === lines - 1 ? 'w-1/2' : widths[i % widths.length])}
        />
      ))}
    </div>
  )
}
