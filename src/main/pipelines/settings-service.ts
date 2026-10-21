import type { PublicSettings } from '@shared/settings'
import type { Handlers, PipelineDeps } from './types'

/** Settings, the API key (stored by the composition root's SecretStore), provider health and app info. */
export function createSettingsService(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'secrets' | 'openAiSecrets' | 'connections' | 'aiFor' | 'appInfo'>
): {
  handlers: Pick<
    Handlers,
    | 'app.info'
    | 'settings.get'
    | 'settings.update'
    | 'settings.setApiKey'
    | 'ai.health'
    | 'ai.claudeAccount'
    | 'ai.claudeLogin'
    | 'ai.claudeLoginCode'
    | 'ai.claudeLoginCancel'
    | 'ai.claudeLogout'
    | 'ai.codexAccount'
    | 'ai.codexLogin'
    | 'ai.codexLoginWait'
    | 'ai.codexLoginCancel'
    | 'ai.codexLogout'
    | 'ai.listModels'
  >
} {
  const { claude, codex } = deps.connections
  const { db } = deps

  // Secrets never leave main: the renderer only learns whether a key exists.
  const publicSettings = (): PublicSettings => ({
    ...db.settings.get(),
    hasApiKey: deps.secrets.getApiKey() !== null,
    hasOpenAiCompatibleKey: deps.openAiSecrets.getApiKey() !== null
  })

  return {
    handlers: {
      'app.info': async () => deps.appInfo,

      'settings.get': async () => publicSettings(),

      'settings.update': async (patch) => {
        const before = db.settings.get().provider
        const next = db.settings.update(patch)
        if (patch.aiConcurrency !== undefined) deps.queue.setConcurrency(next.aiConcurrency)
        // A rate limit belongs to the provider that hit it: switching away resumes the queue now.
        if (next.provider !== before) deps.queue.pauseUntil(null)
        return publicSettings()
      },

      'settings.setApiKey': async ({ apiKey, provider }) => {
        const store = provider === 'openai-compatible' ? deps.openAiSecrets : deps.secrets
        store.setApiKey(apiKey === null ? null : apiKey.trim())
        return publicSettings()
      },

      'ai.health': async ({ provider }) => deps.aiFor(provider ?? undefined).provider.health(),

      'ai.claudeAccount': () => claude.status(),
      'ai.claudeLogin': ({ method }) => claude.login(method),
      'ai.claudeLoginCode': ({ code }) => claude.submitCode(code),
      'ai.claudeLoginCancel': async () => {
        claude.cancelLogin()
        return { ok: true }
      },
      'ai.claudeLogout': () => claude.logout(),
      'ai.codexAccount': () => codex.status(),
      'ai.codexLogin': () => codex.login(),
      'ai.codexLoginWait': () => codex.waitForLogin(),
      'ai.codexLoginCancel': async () => {
        codex.cancelLogin()
        return { ok: true }
      },
      'ai.codexLogout': () => codex.logout(),

      // A failure is data here: the settings form shows it next to the URL field.
      'ai.listModels': async ({ baseUrl }) => {
        try {
          return {
            models: await deps.connections.listModels(baseUrl, deps.openAiSecrets.getApiKey()),
            error: null
          }
        } catch (err) {
          return { models: [], error: err instanceof Error ? err.message : String(err) }
        }
      }
    }
  }
}
