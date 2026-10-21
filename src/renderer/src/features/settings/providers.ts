import { presetFor } from '@shared/ai/connections'
import type { PublicSettings } from '@shared/settings'

export type ChoosableProvider = 'claude-code' | 'anthropic-api' | 'codex' | 'openai-compatible'

export const PROVIDERS: { id: ChoosableProvider; title: string; short: string; body: string }[] = [
  {
    id: 'claude-code',
    title: 'Claude subscription',
    short: 'Claude subscription',
    body: 'Your Claude Pro or Max plan through Claude Code on this computer. Nothing is billed per request.'
  },
  {
    id: 'anthropic-api',
    title: 'Anthropic API key',
    short: 'API key',
    body: 'Pay per request with your own key from the Anthropic Console. Set a monthly budget below.'
  },
  {
    id: 'codex',
    title: 'ChatGPT subscription',
    short: 'ChatGPT (Codex)',
    body: 'Your ChatGPT plan through Codex, OpenAI’s CLI, on this computer. Nothing is billed per request.'
  },
  {
    id: 'openai-compatible',
    title: 'Local or other model',
    short: 'Local model',
    body: 'Ollama, LM Studio, DeepSeek and other OpenAI-compatible servers. Free when it runs on this computer.'
  }
]

/** Short label for the status bar, e.g. "Local: Ollama". */
export function providerLabel(settings: Pick<PublicSettings, 'provider' | 'openaiBaseUrl'>): string {
  if (settings.provider === 'fake') return 'Test provider'
  if (settings.provider === 'openai-compatible') {
    const preset = presetFor(settings.openaiBaseUrl)
    return preset.id === 'custom' ? 'Local model' : `${preset.local ? 'Local' : 'Model'}: ${preset.label}`
  }
  return PROVIDERS.find((p) => p.id === settings.provider)?.short ?? settings.provider
}

/** Why a provider cannot be used yet, or null when it is ready to switch to. */
export function notReady(id: ChoosableProvider, settings: PublicSettings): string | null {
  if (id === 'anthropic-api' && !settings.hasApiKey) return 'Add your API key in Settings first'
  if (
    id === 'openai-compatible' &&
    presetFor(settings.openaiBaseUrl).needsKey &&
    !settings.hasOpenAiCompatibleKey
  )
    return 'Add the server key in Settings first'
  return null
}
