import type { LlmProvider, ProviderId } from '@shared/ai/provider'
import type { Settings } from '@shared/settings'
import type { StudyAi } from '../ai/types'
import type { SecretStore } from '../pipelines/types'

/**
 * Caches one StudyAi per provider and rebuilds it when the inputs that provider was built from change.
 * Each lookup compares a small fingerprint of just those settings (models, executable path) plus the
 * API key, so a settings change that does not concern a provider (theme, concurrency) keeps its
 * instance, while a new key or model takes effect on the very next call without explicit plumbing.
 */

export interface AiRegistryDeps {
  getSettings(): Settings
  secrets: Pick<SecretStore, 'getApiKey'>
  /** Key for the OpenAI-compatible server. */
  openAiSecrets: Pick<SecretStore, 'getApiKey'>
  createProvider(settings: Settings, secrets: { apiKey: string | null }): LlmProvider
  createStudyAi(provider: LlmProvider): StudyAi
  /** Serve this provider for every lookup, whatever is asked or configured (smoke runs use 'fake'). */
  forceProvider?: ProviderId
}

export interface AiRegistry {
  /** StudyAi for `provider`, or for the provider in current settings when omitted. */
  aiFor(provider?: ProviderId): StudyAi
  /** Drop all cached instances (e.g. after a settings import). */
  invalidate(): void
}

/** Fingerprint of the settings a provider is built from. The API key is compared separately, never put here. */
export function providerFingerprint(provider: ProviderId, settings: Settings): string {
  switch (provider) {
    case 'claude-code':
      return JSON.stringify([provider, settings.models['claude-code'], settings.claudeCodePath])
    case 'anthropic-api':
      return JSON.stringify([provider, settings.models['anthropic-api']])
    case 'openai-compatible':
      return JSON.stringify([provider, settings.models['openai-compatible'], settings.openaiBaseUrl])
    case 'codex':
      return JSON.stringify([provider, settings.models.codex])
    case 'fake':
      return provider
  }
}

interface Entry {
  fingerprint: string
  /** The key the provider was built with. The provider holds it in memory anyway; kept for comparison only. */
  apiKey: string | null
  ai: StudyAi
}

export function createAiRegistry(deps: AiRegistryDeps): AiRegistry {
  const cache = new Map<ProviderId, Entry>()

  return {
    aiFor(requested) {
      const settings = deps.getSettings()
      const provider = deps.forceProvider ?? requested ?? settings.provider
      // Only key-based providers read the keyring.
      const apiKey =
        provider === 'anthropic-api'
          ? deps.secrets.getApiKey()
          : provider === 'openai-compatible'
            ? deps.openAiSecrets.getApiKey()
            : null
      const fingerprint = providerFingerprint(provider, settings)
      const hit = cache.get(provider)
      if (hit && hit.fingerprint === fingerprint && hit.apiKey === apiKey) return hit.ai

      const ai = deps.createStudyAi(deps.createProvider({ ...settings, provider }, { apiKey }))
      cache.set(provider, { fingerprint, apiKey, ai })
      return ai
    },
    invalidate() {
      cache.clear()
    }
  }
}
