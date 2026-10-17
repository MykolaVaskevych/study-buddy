import { useId } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../../components'

/** A titled block of settings. */
export function SettingsSection({
  title,
  description,
  children
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}): React.JSX.Element {
  const id = useId()
  return (
    <section aria-labelledby={id} className="flex flex-col gap-5 border-t border-rule pt-7">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="font-serif text-lg font-semibold">
          {title}
        </h2>
        {description ? <p className="max-w-[60ch] text-sm text-graphite">{description}</p> : null}
      </div>
      {children}
    </section>
  )
}

/** Label and explanation on the left, the control on the right; stacks on narrow windows. */
export function SettingRow({
  label,
  description,
  htmlFor,
  children,
  className
}: {
  label: string
  description?: ReactNode
  /** Id of the control, so clicking the label focuses it. */
  htmlFor?: string
  children: ReactNode
  className?: string
}): React.JSX.Element {
  return (
    <div className={cx('flex flex-wrap items-start justify-between gap-x-8 gap-y-2', className)}>
      <div className="flex max-w-[46ch] min-w-0 flex-1 flex-col gap-0.5">
        <label htmlFor={htmlFor} className="font-semibold text-ink">
          {label}
        </label>
        {description ? <div className="text-sm text-graphite">{description}</div> : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">{children}</div>
    </div>
  )
}
