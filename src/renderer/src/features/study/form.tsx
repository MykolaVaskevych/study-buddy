import { useId } from 'react'
import type { ReactNode } from 'react'
import { cx } from '../../components'

/**
 * Form controls shared by the study, quiz, review and settings screens. Native inputs underneath
 * (radio groups, checkboxes), so arrow keys, labels and screen readers work without extra code.
 */

export const fieldClass =
  'h-9 rounded-md border border-rule-strong bg-sheet px-3 text-base text-ink outline-none transition-colors placeholder:text-faint focus:border-accent disabled:opacity-60'

export interface SegmentOption<T extends string> {
  value: T
  label: ReactNode
  disabled?: boolean
}

interface SegmentedProps<T extends string> {
  /** Accessible name of the group. */
  label: string
  value: T
  options: SegmentOption<T>[]
  onChange: (value: T) => void
  size?: 'sm' | 'md'
  className?: string
}

/** One-of-n choice drawn as a segmented control (a radio group underneath). */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  size = 'md',
  className
}: SegmentedProps<T>): React.JSX.Element {
  const name = useId()
  return (
    <fieldset className={cx('inline-flex min-w-0', className)}>
      <legend className="sr-only">{label}</legend>
      <div className="inline-flex min-w-0 rounded-md bg-sunken p-0.5">
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={o.value}
              className={cx(
                'inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[5px] font-semibold whitespace-nowrap transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus',
                size === 'sm' ? 'h-6 px-2 text-xs' : 'h-8 px-3 text-sm',
                checked ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(20_30_55/0.12)]' : 'text-graphite',
                o.disabled ? 'cursor-not-allowed opacity-50' : !checked && 'cursor-pointer hover:text-ink'
              )}
            >
              <input
                type="radio"
                name={name}
                className="sr-only"
                checked={checked}
                disabled={o.disabled}
                onChange={() => onChange(o.value)}
              />
              <span className="truncate">{o.label}</span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

interface SwitchProps {
  checked: boolean
  onChange: (checked: boolean) => void
  /** Visible label. */
  label: string
  description?: ReactNode
  disabled?: boolean
}

/** On/off setting with its label and an optional explanation. */
export function Switch({ checked, onChange, label, description, disabled }: SwitchProps): React.JSX.Element {
  const id = useId()
  return (
    <div className="flex items-start justify-between gap-6">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span id={`${id}-label`} className="font-semibold text-ink">
          {label}
        </span>
        {description ? (
          <span id={`${id}-desc`} className="text-sm text-graphite">
            {description}
          </span>
        ) : null}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={`${id}-label`}
        aria-describedby={description ? `${id}-desc` : undefined}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={cx(
          'relative mt-0.5 inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50',
          checked ? 'bg-accent' : 'bg-rule-strong'
        )}
      >
        <span
          aria-hidden
          className={cx(
            'inline-block size-4 rounded-full bg-sheet shadow-[0_1px_2px_rgb(20_30_55/0.3)] transition-transform duration-150',
            checked ? 'translate-x-[1.125rem]' : 'translate-x-0.5'
          )}
        />
      </button>
    </div>
  )
}
