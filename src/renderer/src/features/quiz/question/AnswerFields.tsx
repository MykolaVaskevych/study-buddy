import type { Ref } from 'react'
import { cx, Kbd } from '../../../components'
import { fieldClass } from '../../study/form'
import type { Draft } from './response'

type NumericDraft = Extract<Draft, { type: 'numeric' }>
type ShortDraft = Extract<Draft, { type: 'short' }>

interface NumericProps {
  draft: NumericDraft
  onChange: (draft: NumericDraft) => void
  onSubmit: () => void
  locked: boolean
  describedBy: string
  inputRef?: Ref<HTMLInputElement>
}

/** Value and unit side by side; the unit is graded too (dB vs dBm, prefixes). */
export function NumericAnswer({
  draft,
  onChange,
  onSubmit,
  locked,
  describedBy,
  inputRef
}: NumericProps): React.JSX.Element {
  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      onSubmit()
    }
  }
  return (
    <div className="flex items-end gap-2">
      <label className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="text-sm font-semibold text-graphite">Value</span>
        <input
          ref={inputRef}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          aria-describedby={describedBy}
          value={draft.value}
          disabled={locked}
          onChange={(e) => onChange({ ...draft, value: e.target.value })}
          onKeyDown={onKeyDown}
          className={cx(fieldClass, 'tabular w-full font-serif text-md')}
          placeholder="e.g. 0.25 or 3e8"
        />
      </label>
      <label className="flex w-28 shrink-0 flex-col gap-1">
        <span className="text-sm font-semibold text-graphite">Unit</span>
        <input
          autoComplete="off"
          spellCheck={false}
          value={draft.unit}
          disabled={locked}
          onChange={(e) => onChange({ ...draft, unit: e.target.value })}
          onKeyDown={onKeyDown}
          className={cx(fieldClass, 'w-full font-serif text-md')}
          placeholder="unit"
        />
      </label>
    </div>
  )
}

interface ShortProps {
  draft: ShortDraft
  onChange: (draft: ShortDraft) => void
  onSubmit: () => void
  locked: boolean
  labelledBy: string
  inputRef?: Ref<HTMLTextAreaElement>
}

/** Free-text answer, marked against a rubric. Mod+Enter checks; Enter is a new line. */
export function ShortAnswer({
  draft,
  onChange,
  onSubmit,
  locked,
  labelledBy,
  inputRef
}: ShortProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        ref={inputRef}
        aria-labelledby={labelledBy}
        rows={4}
        value={draft.text}
        disabled={locked}
        maxLength={5000}
        onChange={(e) => onChange({ ...draft, text: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault()
            onSubmit()
          }
        }}
        className={cx(fieldClass, 'h-auto min-h-24 w-full resize-y py-2 font-serif text-md leading-relaxed')}
        placeholder="Answer in your own words"
      />
      <p className="flex items-center gap-1.5 text-xs text-graphite">
        <Kbd keys="Mod+Enter" /> to check
      </p>
    </div>
  )
}
