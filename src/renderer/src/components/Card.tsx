import type { HTMLAttributes } from 'react'
import { cx } from './cx'

interface CardProps extends HTMLAttributes<HTMLElement> {
  /** 'sheet' sits on paper; 'sunken' is a recessed well for secondary content. */
  surface?: 'sheet' | 'sunken'
  as?: 'div' | 'article' | 'section' | 'li'
  padded?: boolean
}

/** A bordered surface. No drop shadow: elevation is reserved for things that float (popovers, pages). */
export function Card({
  surface = 'sheet',
  as: Tag = 'div',
  padded = true,
  className,
  ...rest
}: CardProps): React.JSX.Element {
  return (
    <Tag
      className={cx(
        'rounded-lg border',
        surface === 'sheet' ? 'border-rule bg-sheet' : 'border-transparent bg-sunken',
        padded && 'p-4',
        className
      )}
      {...rest}
    />
  )
}
