import { createHash } from 'node:crypto'
import type { LlmProvider, ProviderId } from '@shared/ai/provider'
import type { Settings } from '@shared/settings'
import type { StudyAi } from '../ai/types'
import type { SecretStore } from '../pipelines/types'

/**
 * Caches one StudyAi per provider and rebuilds it when the inputs that provider was built from change.
 * Each lookup computes a small fingerprint of just those inputs (models, executable path, API key
 * digest), so a settings change that does not concern a provider (theme, concurrency) keeps its
 * instance, while a new key or model takes effect on the very next call without explicit plumbing.
 */

export interface AiRegistryDeps {
  getSettings(): Settings
  secrets: Pick<SecretStore, 'getApiKey'>
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

const digest = (value: string): string => createHash('sha256').update(value).digest('hex').slice(0, 16)

/** Fingerprint of the inputs a provider is built from. Holds a digest of the key, never the key. */
export function providerFingerprint(provider: ProviderId, settings: Settings, apiKey: string | null): string {
  switch (provider) {
    case 'claude-code':
      return JSON.stringify([provider, settings.models['claude-code'], settings.claudeCodePath])
    case 'anthropic-api':
      return JSON.stringify([
        provider,
        settings.models['anthropic-api'],
        apiKey === null ? null : digest(apiKey)
      ])
    case 'fake':
      return provider
  }
}

export function createAiRegistry(deps: AiRegistryDeps): AiRegistry {
  const cache = new Map<ProviderId, { fingerprint: string; ai: StudyAi }>()

  return {
    aiFor(requested) {
      const settings = deps.getSettings()
      const provider = deps.forceProvider ?? requested ?? settings.provider
      // Only the API provider needs the key; skip the keyring otherwise.
      const apiKey = provider === 'anthropic-api' ? deps.secrets.getApiKey() : null
      const fingerprint = providerFingerprint(provider, settings, apiKey)
      const hit = cache.get(provider)
      if (hit && hit.fingerprint === fingerprint) return hit.ai

      const ai = deps.createStudyAi(deps.createProvider({ ...settings, provider }, { apiKey }))
      cache.set(provider, { fingerprint, ai })
      return ai
    },
    invalidate() {
      cache.clear()
    }
  }
}
