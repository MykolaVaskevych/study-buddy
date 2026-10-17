import { useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../../components'
import './planner.css'

/**
 * Form controls for the planner, built on native inputs so keyboard use and screen readers work
 * without extra code: a range slider that announces a formatted value, a segmented radio group,
 * and radio cards with a description per option.
 */

interface SliderProps {
  label: string
  value: number
  min: number
  max: number
  step: number
  /** Shown beside the label and announced instead of the raw number, e.g. "2 h 30 m a day". */
  valueText: string
  onChange: (value: number) => void
  hint?: ReactNode
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  valueText,
  onChange,
  hint
}: SliderProps): React.JSX.Element {
  const id = useId()
  const fill = ((Math.min(max, Math.max(min, value)) - min) / (max - min || 1)) * 100
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-sm font-semibold text-ink">
          {label}
        </label>
        {/* The slider announces valueText itself; this copy is for the eye only. */}
        <span aria-hidden className="tabular text-md font-semibold text-ink">
          {valueText}
        </span>
      </div>
      <input
        id={id}
        type="range"
        className="sb-range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-valuetext={valueText}
        aria-describedby={hint ? `${id}-hint` : undefined}
        style={{ '--fill': `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-xs text-graphite">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export interface Choice<T extends string> {
  value: T
  label: string
  /** Radio cards only: one line under the label. */
  description?: string
}

interface ChoiceProps<T extends string> {
  legend: string
  value: T
  options: readonly Choice<T>[]
  onChange: (value: T) => void
  /** Keep the legend for screen readers only, when a visible heading already names the group. */
  hideLegend?: boolean
  className?: string
}

const focusRing =
  'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-focus'

/** A row of mutually exclusive options (radio group); arrow keys move between them. */
export function Segmented<T extends string>({
  legend,
  value,
  options,
  onChange,
  hideLegend = false,
  className
}: ChoiceProps<T>): React.JSX.Element {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend className={cx('mb-1.5 text-sm font-semibold text-ink', hideLegend && 'sr-only')}>
        {legend}
      </legend>
      <div className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-md bg-sunken p-0.5">
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={o.value}
              className={cx(
                'flex h-7 cursor-pointer items-center justify-center rounded-[5px] px-2 text-sm font-semibold whitespace-nowrap transition-colors',
                focusRing,
                checked
                  ? 'bg-sheet text-ink shadow-[0_1px_2px_rgb(20_30_55/0.14)]'
                  : 'text-graphite hover:text-ink'
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="sr-only"
              />
              {o.label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

/** Stacked radio options with a description each, for choices that need a sentence to explain. */
export function RadioCards<T extends string>({
  legend,
  value,
  options,
  onChange,
  className
}: ChoiceProps<T>): React.JSX.Element {
  const name = useId()
  return (
    <fieldset className={className}>
      <legend className="mb-1.5 text-sm font-semibold text-ink">{legend}</legend>
      <div className="flex flex-col gap-1.5">
        {options.map((o) => {
          const checked = o.value === value
          return (
            <label
              key={o.value}
              className={cx(
                'flex cursor-pointer gap-2.5 rounded-md border px-3 py-2 transition-colors',
                focusRing,
                checked ? 'border-ink bg-sheet' : 'border-rule hover:border-rule-strong'
              )}
            >
              <input
                type="radio"
                name={name}
                value={o.value}
                checked={checked}
                onChange={() => onChange(o.value)}
                className="mt-0.5 size-3.5 shrink-0 accent-ink outline-none"
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-semibold text-ink">{o.label}</span>
                {o.description ? <span className="text-xs text-graphite">{o.description}</span> : null}
              </span>
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
