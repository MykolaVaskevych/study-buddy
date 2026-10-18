/**
 * Ways to reach a model, as the settings screen offers them. Pure data and helpers: the
 * provider in main and the settings UI both read the presets, so a URL maps to the same preset
 * (and the same limits) on both sides.
 */

export type OpenAiPresetId = 'ollama' | 'lmstudio' | 'llamacpp' | 'deepseek' | 'openrouter' | 'custom'

export interface OpenAiPreset {
  id: OpenAiPresetId
  label: string
  /** Empty for 'custom'. */
  baseUrl: string
  needsKey: boolean
  /** Runs on this computer: no cost, no key, and the server may need to be started first. */
  local: boolean
  /** Suggested model ids; the server's own /models list is shown first when it answers. */
  models: string[]
  /** Some hosted APIs cap output low unless asked; null = leave it to the server. */
  maxTokens: number | null
  /** One line on how to get it running. */
  hint: string
}

const CUSTOM_PRESET: OpenAiPreset = {
  id: 'custom',
  label: 'Other server',
  baseUrl: '',
  needsKey: false,
  local: false,
  models: [],
  maxTokens: null,
  hint: 'Any server with an OpenAI-style /v1/chat/completions endpoint.'
}

export const OPENAI_PRESETS: readonly OpenAiPreset[] = [
  {
    id: 'ollama',
    label: 'Ollama',
    baseUrl: 'http://localhost:11434/v1',
    needsKey: false,
    local: true,
    models: ['qwen3.6:27b', 'qwen3.6:35b-a3b', 'gpt-oss:20b'],
    maxTokens: null,
    hint: 'Run "ollama serve" (or enable the ollama service), then "ollama pull qwen3.6:27b". Start it with OLLAMA_CONTEXT_LENGTH=32768 so a 10-page chunk fits.'
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    baseUrl: 'http://localhost:1234/v1',
    needsKey: false,
    local: true,
    models: [],
    maxTokens: null,
    hint: 'Load a model in LM Studio and start its local server (Developer tab). Set the context length to 32k or more.'
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp server',
    baseUrl: 'http://localhost:8080/v1',
    needsKey: false,
    local: true,
    models: [],
    maxTokens: null,
    hint: 'Start llama-server with -c 32768 (or more) so whole chunks fit.'
  },
  {
    id: 'deepseek',
    label: 'DeepSeek API',
    baseUrl: 'https://api.deepseek.com/v1',
    needsKey: true,
    local: false,
    models: ['deepseek-chat', 'deepseek-reasoner'],
    maxTokens: 8192,
    hint: 'Create a key at platform.deepseek.com. Billed by DeepSeek per request.'
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    needsKey: true,
    local: false,
    models: [],
    maxTokens: null,
    hint: 'One key for many hosted models. Create it at openrouter.ai/keys.'
  },
  CUSTOM_PRESET
]

const sameUrl = (a: string, b: string): boolean => a.replace(/\/+$/, '') === b.replace(/\/+$/, '')

/** The preset whose URL matches, else 'custom'. */
export function presetFor(baseUrl: string): OpenAiPreset {
  const match = OPENAI_PRESETS.find((p) => p.baseUrl !== '' && sameUrl(p.baseUrl, baseUrl))
  return match ?? CUSTOM_PRESET
}

/** True for loopback hosts: requests stay on this computer and cost nothing. */
export function isLocalUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname
    return host === 'localhost' || host === '[::1]' || /^127\./.test(host)
  } catch {
    return false
  }
}

/** The Claude Code login state, from `claude auth status`. */
export interface ClaudeAccount {
  /** False when no Claude Code executable was found. */
  installed: boolean
  loggedIn: boolean
  /** e.g. 'claude.ai' (subscription) or 'console' (API billing through Claude Code). */
  method: string | null
  email: string | null
  /** Subscription plan such as 'pro' or 'max', when logged in with claude.ai. */
  plan: string | null
  /** Why the state could not be read, or what to do next; null when all is well. */
  problem: string | null
}

/** Login in progress: the browser opens the sign-in page; the page then shows a code to paste here. */
export interface ClaudeLoginStart {
  /** The sign-in page, in case the browser did not open. */
  url: string | null
}
