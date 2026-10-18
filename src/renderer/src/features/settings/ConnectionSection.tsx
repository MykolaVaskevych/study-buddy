import { useId } from 'react'
import type { PublicSettings } from '@shared/settings'
import { useCheckAiHealth, useUpdateSettings } from '../../api/hooks'
import { Button, cx, Icon } from '../../components'
import { ApiKeyField } from './ApiKeyField'
import { ClaudeAccountPanel } from './ClaudeAccountPanel'
import { LocalServerPanel } from './LocalServerPanel'
import { SettingsSection } from './layout'
import { PROVIDERS } from './providers'

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

/**
 * Which AI to use: the Claude subscription (with sign-in), an Anthropic API key, or a local /
 * OpenAI-compatible server. Picking a card switches at once; the status bar switches too.
 */
export function ConnectionSection({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const name = useId()
  return (
    <SettingsSection title="AI connection">
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Connect with</legend>
        <div data-tour="ai-connection" className="grid gap-3 sm:grid-cols-3">
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
      {settings.provider === 'claude-code' ? <ClaudeAccountPanel /> : null}
      {settings.provider === 'anthropic-api' ? <ApiKeyField hasKey={settings.hasApiKey} /> : null}
      {settings.provider === 'openai-compatible' ? <LocalServerPanel settings={settings} /> : null}
      <ConnectionTest key={settings.provider} provider={settings.provider} />
    </SettingsSection>
  )
}
