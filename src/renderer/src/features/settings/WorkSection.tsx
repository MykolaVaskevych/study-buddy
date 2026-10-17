import { useId, useState } from 'react'
import type { PublicSettings } from '@shared/settings'
import { useUpdateSettings } from '../../api/hooks'
import { cx } from '../../components'
import { fieldClass, Segmented, Switch } from '../study/form'
import { SettingRow, SettingsSection } from './layout'

const LANGUAGES: [string, string][] = [
  ['auto', 'Same as the book'],
  ['en', 'English'],
  ['de', 'Deutsch'],
  ['fr', 'Français'],
  ['es', 'Español'],
  ['it', 'Italiano'],
  ['nl', 'Nederlands'],
  ['pl', 'Polski'],
  ['pt', 'Português'],
  ['cs', 'Čeština'],
  ['sv', 'Svenska'],
  ['tr', 'Türkçe'],
  ['uk', 'Українська']
]

/** Budget in dollars; empty means no cap. Saved on blur or Enter. */
function BudgetField({ value, disabled }: { value: number | null; disabled: boolean }): React.JSX.Element {
  const update = useUpdateSettings()
  const id = useId()
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  const parsed = draft.trim() === '' ? null : Number(draft.replace(',', '.'))
  const invalid = parsed !== null && (!Number.isFinite(parsed) || parsed < 0)
  const commit = (): void => {
    if (!invalid && parsed !== value) update.mutate({ monthlyBudgetUsd: parsed })
  }
  return (
    <SettingRow
      label="Monthly budget"
      htmlFor={id}
      description={
        disabled
          ? 'Only for an API key. A subscription is not billed per request.'
          : invalid
            ? 'Enter an amount in dollars, or leave it empty for no limit.'
            : 'New AI work pauses once this month’s spend reaches the limit. Leave empty for no limit.'
      }
    >
      <span className={cx('flex items-center gap-1.5 text-graphite', disabled && 'opacity-60')}>
        $
        <input
          id={id}
          inputMode="decimal"
          disabled={disabled}
          value={draft}
          placeholder="No limit"
          aria-invalid={invalid || undefined}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
          }}
          className={cx(fieldClass, 'tabular w-28', invalid && 'border-redpen')}
        />
      </span>
    </SettingRow>
  )
}

/** How Claude works in the background: parallelism, prefetching, answer-key checks, budget. */
export function WorkSection({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const concurrencyId = useId()
  return (
    <SettingsSection title="Background work">
      <SettingRow
        label="Requests at a time"
        htmlFor={concurrencyId}
        description={
          settings.provider === 'claude-code'
            ? 'Subscription runs are heavier; 2 or 3 keeps you clear of usage limits.'
            : 'More is faster, up to your API rate limit.'
        }
      >
        <select
          id={concurrencyId}
          value={settings.aiConcurrency}
          onChange={(e) => update.mutate({ aiConcurrency: Number(e.target.value) })}
          className={cx(fieldClass, 'tabular w-20 pr-6')}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      </SettingRow>
      <Switch
        label="Prepare page checks while you read"
        description="Questions for the page you are on are written in the background, so Test me opens instantly. Uses more of your allowance."
        checked={settings.prefetchPageChecks}
        onChange={(v) => update.mutate({ prefetchPageChecks: v })}
      />
      <Switch
        label="Double-check answer keys"
        description="A second, blind pass answers each new question and drops the ones whose key it disagrees with. Slower, but fewer wrong keys."
        checked={settings.verifyAnswerKeys}
        onChange={(v) => update.mutate({ verifyAnswerKeys: v })}
      />
      <BudgetField
        key={String(settings.monthlyBudgetUsd)}
        value={settings.monthlyBudgetUsd}
        disabled={settings.provider !== 'anthropic-api'}
      />
    </SettingsSection>
  )
}

/** Language of generated content, and the app's colour theme. */
export function AppearanceSection({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const languageId = useId()
  const known = LANGUAGES.some(([code]) => code === settings.contentLanguage)
  const languages = known ? LANGUAGES : [...LANGUAGES, [settings.contentLanguage, settings.contentLanguage]]
  return (
    <SettingsSection title="Language and theme">
      <SettingRow
        label="Write notes and questions in"
        htmlFor={languageId}
        description="Applies to new content. Existing notes and cards stay as they are."
      >
        <select
          id={languageId}
          value={settings.contentLanguage}
          onChange={(e) => update.mutate({ contentLanguage: e.target.value })}
          className={cx(fieldClass, 'w-48 pr-6')}
        >
          {languages.map(([code, label]) => (
            <option key={code} value={code}>
              {label}
            </option>
          ))}
        </select>
      </SettingRow>
      <SettingRow label="Theme" description="Dark is easier on the eyes for late-night study.">
        <Segmented
          label="Theme"
          value={settings.theme}
          onChange={(theme) => update.mutate({ theme })}
          options={[
            { value: 'system', label: 'Match system' },
            { value: 'light', label: 'Light' },
            { value: 'dark', label: 'Dark' }
          ]}
        />
      </SettingRow>
    </SettingsSection>
  )
}
