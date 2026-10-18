import { useId, useState } from 'react'
import { OPENAI_PRESETS, presetFor, type OpenAiPreset } from '@shared/ai/connections'
import type { PublicSettings } from '@shared/settings'
import { useServerModels, useUpdateSettings } from '../../api/hooks'
import { Button, cx, Icon } from '../../components'
import { fieldClass } from '../study/form'
import { ApiKeyField } from './ApiKeyField'

/** Base URL; saved on blur or Enter when it parses as http(s). Keyed by the stored value. */
function UrlField({ value, onSave }: { value: string; onSave: (url: string) => void }): React.JSX.Element {
  const [draft, setDraft] = useState(value)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const commit = (): void => {
    const url = draft.trim()
    if (url === value) return
    try {
      const u = new URL(url)
      if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('protocol')
      setError(null)
      onSave(url)
    } catch {
      setError('Enter a full address such as http://localhost:11434/v1')
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold">
        Server address
      </label>
      <input
        id={id}
        value={draft}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
        }}
        aria-invalid={error !== null || undefined}
        className={cx(fieldClass, 'font-mono text-sm')}
      />
      {error ? <p className="text-sm text-redpen">{error}</p> : null}
    </div>
  )
}

function ServerModels({ baseUrl, preset }: { baseUrl: string; preset: OpenAiPreset }): React.JSX.Element {
  const models = useServerModels(baseUrl)
  const r = models.data
  return (
    <div aria-live="polite" className="flex flex-wrap items-center gap-2 text-sm">
      {models.isFetching ? (
        <span className="text-graphite">Asking the server for its models…</span>
      ) : r?.error ? (
        <span className="flex items-start gap-2 text-redpen">
          <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
          {r.error}
        </span>
      ) : r && r.models.length > 0 ? (
        <span className="text-graphite">
          <Icon name="check" size={14} className="mr-1 inline text-ok" />
          {r.models.length} model{r.models.length === 1 ? '' : 's'} on the server. Pick them under Models
          below.
        </span>
      ) : r ? (
        <span className="text-graphite">
          The server answered but lists no models.
          {preset.id === 'ollama' ? ' Pull one: ollama pull qwen3.6:27b' : ''}
        </span>
      ) : null}
      <Button size="sm" variant="ghost" onClick={() => void models.refetch()}>
        Check again
      </Button>
    </div>
  )
}

/** Preset, address, optional key and a live model check for an OpenAI-compatible server. */
export function LocalServerPanel({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const preset = presetFor(settings.openaiBaseUrl)
  const [custom, setCustom] = useState(preset.id === 'custom')
  const shown = custom ? 'custom' : preset.id

  const choose = (p: OpenAiPreset): void => {
    if (p.id === 'custom') {
      setCustom(true)
      return
    }
    setCustom(false)
    // Suggested models come with the preset, unless the student already picked one there.
    const models =
      p.models[0] && presetFor(settings.openaiBaseUrl).id !== p.id
        ? { ...settings.models, 'openai-compatible': { fast: p.models[0], smart: p.models[0] } }
        : settings.models
    update.mutate({ openaiBaseUrl: p.baseUrl, models })
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="radiogroup" aria-label="Server" className="flex flex-wrap gap-2">
        {OPENAI_PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            role="radio"
            aria-checked={shown === p.id}
            onClick={() => choose(p)}
            className={cx(
              'rounded-md border px-3 py-1.5 text-sm',
              shown === p.id
                ? 'border-ink bg-ink text-paper'
                : 'border-rule-strong text-graphite hover:text-ink'
            )}
          >
            {p.label}
          </button>
        ))}
      </div>
      <p className="text-sm text-graphite">{(custom ? OPENAI_PRESETS.at(-1) : preset)?.hint}</p>
      {custom || preset.id === 'custom' ? (
        <UrlField
          key={settings.openaiBaseUrl}
          value={settings.openaiBaseUrl}
          onSave={(url) => update.mutate({ openaiBaseUrl: url })}
        />
      ) : (
        <p className="font-mono text-sm text-graphite">{settings.openaiBaseUrl}</p>
      )}
      <ServerModels baseUrl={settings.openaiBaseUrl} preset={preset} />
      {preset.needsKey || custom || preset.id === 'custom' ? (
        <ApiKeyField
          provider="openai-compatible"
          hasKey={settings.hasOpenAiCompatibleKey}
          optional={!preset.needsKey}
        />
      ) : null}
      <p className="rounded-md bg-sunken p-3 text-sm text-graphite">
        These models read the text of each page. Image-only slides are skipped, and cards and grading are
        simpler than with Claude. For a 24 GB graphics card, qwen3.6:27b is a good start; with less memory,
        try gpt-oss:20b.
      </p>
    </div>
  )
}
