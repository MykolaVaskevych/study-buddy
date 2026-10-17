import { describe, expect, it, vi } from 'vitest'
import type { LlmProvider } from '@shared/ai/provider'
import { DEFAULT_SETTINGS, type Settings } from '@shared/settings'
import type { StudyAi } from '../ai/types'
import { createAiRegistry, providerFingerprint } from './ai-registry'

function setup(initial: Partial<Settings> = {}, opts: { forceProvider?: 'fake' } = {}) {
  let settings: Settings = { ...DEFAULT_SETTINGS, ...initial }
  let apiKey: string | null = 'sk-ant-first-key'
  const getApiKey = vi.fn(() => apiKey)
  const createProvider = vi.fn(
    (s: Settings, secrets: { apiKey: string | null }) =>
      ({ id: s.provider, builtWith: { settings: s, apiKey: secrets.apiKey } }) as unknown as LlmProvider
  )
  const createStudyAi = vi.fn((provider: LlmProvider) => ({ provider }) as StudyAi)
  const registry = createAiRegistry({
    getSettings: () => settings,
    secrets: { getApiKey },
    createProvider,
    createStudyAi,
    ...opts
  })
  return {
    registry,
    createProvider,
    getApiKey,
    update: (patch: Partial<Settings>) => {
      settings = { ...settings, ...patch }
    },
    setKey: (key: string | null) => {
      apiKey = key
    }
  }
}

describe('createAiRegistry', () => {
  it('builds the provider from settings once and caches it', () => {
    const { registry, createProvider } = setup()
    const a = registry.aiFor()
    const b = registry.aiFor()
    expect(a).toBe(b)
    expect(a.provider.id).toBe('claude-code')
    expect(createProvider).toHaveBeenCalledTimes(1)
  })

  it('caches one instance per provider', () => {
    const { registry, createProvider } = setup()
    const claude = registry.aiFor()
    const fake = registry.aiFor('fake')
    expect(fake.provider.id).toBe('fake')
    expect(registry.aiFor('claude-code')).toBe(claude)
    expect(registry.aiFor('fake')).toBe(fake)
    expect(createProvider).toHaveBeenCalledTimes(2)
  })

  it('builds the requested provider even when settings select another', () => {
    const { registry, createProvider } = setup()
    registry.aiFor('anthropic-api')
    expect(createProvider.mock.calls[0]?.[0].provider).toBe('anthropic-api')
    expect(createProvider.mock.calls[0]?.[1]).toEqual({ apiKey: 'sk-ant-first-key' })
  })

  it('rebuilds when a setting of that provider changes, not for unrelated settings', () => {
    const { registry, update } = setup()
    const first = registry.aiFor()
    update({ theme: 'dark', aiConcurrency: 1, prefetchPageChecks: false })
    expect(registry.aiFor()).toBe(first)

    update({ models: { ...DEFAULT_SETTINGS.models, 'claude-code': { fast: 'haiku', smart: 'sonnet' } } })
    const second = registry.aiFor()
    expect(second).not.toBe(first)

    update({ claudeCodePath: '/usr/bin/claude' })
    expect(registry.aiFor()).not.toBe(second)
  })

  it('follows a provider switch in settings', () => {
    const { registry, update } = setup()
    expect(registry.aiFor().provider.id).toBe('claude-code')
    update({ provider: 'anthropic-api' })
    expect(registry.aiFor().provider.id).toBe('anthropic-api')
  })

  it('rebuilds the API provider when the key changes and leaves the others alone', () => {
    const { registry, setKey, getApiKey } = setup({ provider: 'anthropic-api' })
    const api = registry.aiFor()
    const claude = registry.aiFor('claude-code')
    expect(registry.aiFor()).toBe(api)

    setKey('sk-ant-second-key')
    const rebuilt = registry.aiFor()
    expect(rebuilt).not.toBe(api)
    expect(registry.aiFor('claude-code')).toBe(claude)

    setKey(null)
    expect(registry.aiFor()).not.toBe(rebuilt)

    getApiKey.mockClear()
    registry.aiFor('claude-code')
    registry.aiFor('fake')
    expect(getApiKey).not.toHaveBeenCalled()
  })

  it('serves the forced provider for every lookup (smoke runs)', () => {
    const { registry, createProvider } = setup({ provider: 'anthropic-api' }, { forceProvider: 'fake' })
    expect(registry.aiFor().provider.id).toBe('fake')
    expect(registry.aiFor('claude-code').provider.id).toBe('fake')
    expect(createProvider).toHaveBeenCalledTimes(1)
  })

  it('rebuilds everything after invalidate()', () => {
    const { registry } = setup()
    const first = registry.aiFor()
    registry.invalidate()
    expect(registry.aiFor()).not.toBe(first)
  })
})

describe('providerFingerprint', () => {
  it('holds a digest of the API key, never the key itself', () => {
    const fp = providerFingerprint('anthropic-api', DEFAULT_SETTINGS, 'sk-ant-secret-value')
    expect(fp).not.toContain('sk-ant-secret-value')
    expect(fp).not.toBe(providerFingerprint('anthropic-api', DEFAULT_SETTINGS, 'sk-ant-other-value'))
    expect(fp).not.toBe(providerFingerprint('anthropic-api', DEFAULT_SETTINGS, null))
  })
})
