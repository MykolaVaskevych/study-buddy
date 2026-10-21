import { useEffect, useState } from 'react'
import { presetFor } from '@shared/ai/connections'
import type { PublicSettings } from '@shared/settings'
import { useCodexAccount, useRateLimit, useServerModels, useSettings, useUpdateSettings } from '../api/hooks'
import { Button, Icon } from '../components'
import { notReady } from '../features/settings/providers'

/** The other providers that would work right now: a saved API key, a local server that answers. */
function Alternatives({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const update = useUpdateSettings()
  const server = useServerModels(
    notReady('openai-compatible', settings) === null ? settings.openaiBaseUrl : null
  )
  const preset = presetFor(settings.openaiBaseUrl)
  const localUp = (server.data?.models.length ?? 0) > 0
  // The other subscription is the natural fallback when one plan's limit is hit.
  const codex = useCodexAccount(settings.provider !== 'codex')
  const codexReady = settings.provider !== 'codex' && codex.data?.loggedIn === true
  return (
    <span className="ml-auto flex shrink-0 gap-2">
      {settings.hasApiKey ? (
        <Button size="sm" onClick={() => update.mutate({ provider: 'anthropic-api' })}>
          Use my API key meanwhile
        </Button>
      ) : null}
      {codexReady ? (
        <Button size="sm" onClick={() => update.mutate({ provider: 'codex' })}>
          Use ChatGPT (Codex) meanwhile
        </Button>
      ) : null}
      {localUp ? (
        <Button size="sm" onClick={() => update.mutate({ provider: 'openai-compatible' })}>
          Use {preset.id === 'custom' ? 'the local model' : preset.label} meanwhile
        </Button>
      ) : null}
    </span>
  )
}

/** "14:30" in the user's locale. Exported for tests. */
export function formatResetTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/**
 * Shown while the AI's usage limit is hit; hides itself once the reset time has passed. On the
 * subscription it offers the other providers that are set up: switching resumes work at once
 * (the status bar switches back later).
 */
export function RateLimitBanner(): React.JSX.Element | null {
  const { data: info } = useRateLimit()
  const { data: settings } = useSettings()
  const [expiredAt, setExpiredAt] = useState<string | null>(null)
  const resetAt = info?.resetAt ?? null

  useEffect(() => {
    if (!resetAt) return
    const ms = Math.max(0, new Date(resetAt).getTime() - Date.now())
    const t = window.setTimeout(() => setExpiredAt(resetAt), ms)
    return () => window.clearTimeout(t)
  }, [resetAt])

  if (!info || (resetAt !== null && expiredAt === resetAt)) return null
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-rule bg-marker-soft px-6 py-2 text-ink"
    >
      <Icon name="clock" size={18} />
      <p className="text-sm">
        <span className="font-semibold">
          {settings?.provider === 'codex' ? 'ChatGPT' : 'Claude'} usage limit reached
          {info.resetAt ? `, resumes at ${formatResetTime(info.resetAt)}` : ''}.
        </span>{' '}
        <span className="text-graphite">Background work is paused. Reading and reviewing still work.</span>
      </p>
      {settings?.provider === 'claude-code' ? <Alternatives settings={settings} /> : null}
    </div>
  )
}
