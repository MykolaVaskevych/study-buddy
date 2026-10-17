import type { PublicSettings } from '@shared/settings'
import type { Handlers, PipelineDeps } from './types'

/** Settings, the API key (stored by the composition root's SecretStore), provider health and app info. */
export function createSettingsService(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'secrets' | 'aiFor' | 'appInfo'>
): {
  handlers: Pick<
    Handlers,
    'app.info' | 'settings.get' | 'settings.update' | 'settings.setApiKey' | 'ai.health'
  >
} {
  const { db } = deps

  // Secrets never leave main: the renderer only learns whether a key exists.
  const publicSettings = (): PublicSettings => ({
    ...db.settings.get(),
    hasApiKey: deps.secrets.getApiKey() !== null
  })

  return {
    handlers: {
      'app.info': async () => deps.appInfo,

      'settings.get': async () => publicSettings(),

      'settings.update': async (patch) => {
        const next = db.settings.update(patch)
        if (patch.aiConcurrency !== undefined) deps.queue.setConcurrency(next.aiConcurrency)
        return publicSettings()
      },

      'settings.setApiKey': async ({ apiKey }) => {
        deps.secrets.setApiKey(apiKey === null ? null : apiKey.trim())
        return publicSettings()
      },

      'ai.health': async ({ provider }) => deps.aiFor(provider ?? undefined).provider.health()
    }
  }
}
