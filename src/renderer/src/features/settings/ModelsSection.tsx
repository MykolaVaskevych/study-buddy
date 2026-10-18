import { useId, useState } from 'react'
import { presetFor } from '@shared/ai/connections'
import { DEFAULT_SETTINGS } from '@shared/settings'
import type { PublicSettings } from '@shared/settings'
import { useServerModels, useUpdateSettings } from '../../api/hooks'
import { Button, cx } from '../../components'
import { fieldClass } from '../study/form'
import { SettingRow, SettingsSection } from './layout'

type Provider = 'claude-code' | 'anthropic-api' | 'openai-compatible'
type Tier = 'fast' | 'smart'

const TIERS: { tier: Tier; label: string; description: string }[] = [
  {
    tier: 'fast',
    label: 'Fast model',
    description: 'Reads every page for notes. Runs a lot, so it should be quick and cheap.'
  },
  {
    tier: 'smart',
    label: 'Smart model',
    description: 'Writes flashcards and questions, marks written answers and builds the course map.'
  }
]

/** Model ids per tier; saved on blur or Enter. Remounted (keyed) when the stored value changes. */
function ModelField({
  value,
  presets,
  onSave,
  label,
  description
}: {
  value: string
  presets: string[]
  onSave: (model: string) => void
  label: string
  description: string
}): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const id = useId()
  const commit = (): void => {
    const model = draft.trim()
    if (!model) setDraft(value)
    else if (model !== value) onSave(model)
  }
  return (
    <SettingRow label={label} description={description} htmlFor={id}>
      <input
        id={id}
        list={`${id}-presets`}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        className={cx(fieldClass, 'w-56 font-mono text-sm')}
      />
      <datalist id={`${id}-presets`}>
        {presets.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
    </SettingRow>
  )
}

/** Which model each tier uses, for the provider in use. Presets come from DEFAULT_SETTINGS. */
export function ModelsSection({ settings }: { settings: PublicSettings }): React.JSX.Element | null {
  const update = useUpdateSettings()
  const local = settings.provider === 'openai-compatible'
  // Same query (and cache) as the connection panel: the server's installed models come first.
  const server = useServerModels(local ? settings.openaiBaseUrl : null)
  if (settings.provider === 'fake') return null
  const provider: Provider = settings.provider
  const current = settings.models[provider]
  const defaults = DEFAULT_SETTINGS.models[provider]
  const presets = [
    ...new Set([
      ...(local ? [...(server.data?.models ?? []), ...presetFor(settings.openaiBaseUrl).models] : []),
      defaults.fast,
      defaults.smart
    ])
  ]
  const isDefault = current.fast === defaults.fast && current.smart === defaults.smart
  const save = (tier: Tier, model: string): void =>
    update.mutate({ models: { ...settings.models, [provider]: { ...current, [tier]: model } } })

  return (
    <SettingsSection
      title="Models"
      description={
        provider === 'claude-code'
          ? 'Claude Code accepts short names such as haiku or opus.'
          : provider === 'openai-compatible'
            ? 'Model names as the server lists them (for Ollama, e.g. qwen3.6:27b). One model for both is fastest on a single graphics card.'
            : 'Full model ids from the Anthropic API.'
      }
    >
      {TIERS.map(({ tier, label, description }) => (
        <ModelField
          key={`${provider}:${tier}:${current[tier]}`}
          value={current[tier]}
          presets={presets}
          onSave={(m) => save(tier, m)}
          label={label}
          description={description}
        />
      ))}
      {!isDefault ? (
        <div>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => update.mutate({ models: { ...settings.models, [provider]: { ...defaults } } })}
          >
            Use the recommended models ({defaults.fast}, {defaults.smart})
          </Button>
        </div>
      ) : null}
    </SettingsSection>
  )
}
