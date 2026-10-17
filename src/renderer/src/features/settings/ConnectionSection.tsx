import { useId, useState } from 'react'
import type { PublicSettings } from '@shared/settings'
import { useCheckAiHealth, useSetApiKey, useUpdateSettings } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Badge, Button, cx, Icon } from '../../components'
import { fieldClass } from '../study/form'
import { SettingsSection } from './layout'

type ChoosableProvider = 'claude-code' | 'anthropic-api'

const PROVIDERS: { id: ChoosableProvider; title: string; body: string }[] = [
  {
    id: 'claude-code',
    title: 'Claude subscription (Claude Code)',
    body: 'Uses your Claude Pro or Max plan through Claude Code on this computer. Nothing is billed per request.'
  },
  {
    id: 'anthropic-api',
    title: 'Anthropic API key',
    body: 'Pay per request with your own key from the Anthropic Console. Set a monthly budget below.'
  }
]

function ApiKeyField({ hasKey }: { hasKey: boolean }): React.JSX.Element {
  const setKey = useSetApiKey()
  const [replacing, setReplacing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const save = (): void => {
    const key = value.trim()
    if (key.length < 10) {
      setError('That is too short to be an API key. Keys start with "sk-ant-".')
      return
    }
    // Clear the field before sending: the key should not linger in the page.
    setValue('')
    setError(null)
    setKey.mutate(
      { apiKey: key },
      {
        onSuccess: () => {
          setReplacing(false)
          toast({
            tone: 'ok',
            title: 'API key saved',
            body: 'It is stored encrypted by your system keychain.'
          })
        }
      }
    )
  }

  if (hasKey && !replacing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="ok" icon="check">
          Key saved
        </Badge>
        <span className="text-sm text-graphite">Stored encrypted on this computer.</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setReplacing(true)}>
            Replace key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={setKey.isPending}
            onClick={() =>
              setKey.mutate(
                { apiKey: null },
                { onSuccess: () => toast({ tone: 'ok', title: 'API key removed' }) }
              )
            }
          >
            Remove key
          </Button>
        </span>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label htmlFor={inputId} className="font-semibold">
        API key
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          name="anthropic-api-key"
          autoComplete="off"
          spellCheck={false}
          placeholder="sk-ant-…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null || undefined}
          aria-describedby={`${inputId}-help`}
          className={cx(fieldClass, 'min-w-0 flex-1 font-mono text-sm')}
        />
        <Button type="submit" variant="primary" loading={setKey.isPending} disabled={value.trim() === ''}>
          Save key
        </Button>
        {replacing ? (
          <Button variant="ghost" onClick={() => setReplacing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p id={`${inputId}-help`} className={cx('text-sm', error ? 'text-redpen' : 'text-graphite')}>
        {error ?? 'Stored encrypted by your system keychain and only ever sent to Anthropic.'}
      </p>
    </form>
  )
}

function ConnectionTest({ provider }: { provider: PublicSettings['provider'] }): React.JSX.Element {
  const health = useCheckAiHealth()
  const r = health.data
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <Button icon="sparkle" loading={health.isPending} onClick={() => health.mutate({ provider })}>
        Test connection
      </Button>
      <p aria-live="polite" className="flex min-w-0 items-center gap-2 text-sm">
        {r ? (
          r.ok ? (
            <>
              <Icon name="check" size={16} className="text-ok" />
              <span>
                <span className="font-semibold text-ok">Connected.</span>{' '}
                <span className="text-graphite">
                  {r.model ? `${r.model} answered` : 'Answered'}
                  {r.latencyMs !== null ? ` in ${r.latencyMs.toLocaleString()} ms` : ''}.
                </span>
              </span>
            </>
          ) : (
            <>
              <Icon name="alert" size={16} className="text-redpen" />
              <span className="text-redpen">{r.message}</span>
            </>
          )
        ) : health.isError ? (
          <span className="text-redpen">The test could not run: {health.error.message}</span>
        ) : null}
      </p>
    </div>
  )
}

/** Which Claude to use, the API key (never shown once saved), and a connection test. */
export function ConnectionSection({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const name = useId()
  return (
    <SettingsSection title="Claude connection">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Connect with</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {PROVIDERS.map((p) => {
            const checked = settings.provider === p.id
            return (
              <label
                key={p.id}
                className={cx(
                  'flex cursor-pointer gap-3 rounded-lg border p-4 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
                  checked ? 'border-accent bg-accent-soft' : 'border-rule bg-sheet hover:border-rule-strong'
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="sr-only"
                  checked={checked}
                  onChange={() => update.mutate({ provider: p.id })}
                />
                <span
                  aria-hidden
                  className={cx(
                    'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2',
                    checked ? 'border-accent' : 'border-rule-strong'
                  )}
                >
                  {checked ? <span className="size-1.5 rounded-full bg-accent" /> : null}
                </span>
                <span className="flex flex-col gap-1">
                  <span className="font-semibold text-ink">{p.title}</span>
                  <span className="text-sm text-graphite">{p.body}</span>
                </span>
              </label>
            )
          })}
        </div>
        {settings.provider === 'fake' ? (
          <p className="text-sm text-graphite">The test provider is active (no real Claude calls).</p>
        ) : null}
      </fieldset>
      {settings.provider === 'anthropic-api' ? <ApiKeyField hasKey={settings.hasApiKey} /> : null}
      <ConnectionTest key={settings.provider} provider={settings.provider} />
    </SettingsSection>
  )
}
