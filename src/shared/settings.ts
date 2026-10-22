import { z } from 'zod'
import { DEFAULT_ROUTING } from './ai/routing'

export const providerIdSchema = z.enum(['claude-code', 'anthropic-api', 'openai-compatible', 'codex', 'fake'])

const tierModelsSchema = z.object({ fast: z.string().min(1), smart: z.string().min(1) })

const routedTaskSchema = z.enum([
  'index',
  'topics',
  'cards',
  'page_check',
  'questions',
  'verify',
  'grade',
  'chat',
  'lesson',
  'past_paper',
  'explain',
  'naming',
  'portal'
])

export const settingsSchema = z.object({
  provider: providerIdSchema,
  /** Model ids per provider and tier. Claude Code accepts aliases such as 'haiku' / 'opus'. */
  models: z.object({
    'claude-code': tierModelsSchema,
    'anthropic-api': tierModelsSchema,
    'openai-compatible': tierModelsSchema,
    /** Codex CLI on a ChatGPT plan; ids from `codex debug models`. */
    codex: tierModelsSchema
  }),
  /** Base URL of an OpenAI-compatible server (Ollama, LM Studio, llama.cpp, DeepSeek, ...), ending in /v1. */
  openaiBaseUrl: z.url({ protocol: /^https?$/ }),
  /** Max parallel AI calls. Subscription runs are heavier, keep this low. */
  aiConcurrency: z.number().int().min(1).max(8),
  /** Write generated content in this language; 'auto' = the document's language. */
  contentLanguage: z.string(),
  theme: z.enum(['system', 'light', 'dark']),
  /** Stop starting new AI jobs once this month's spend reaches the cap (API provider only). */
  monthlyBudgetUsd: z.number().min(0).nullable(),
  prefetchPageChecks: z.boolean(),
  verifyAnswerKeys: z.boolean(),
  /** Optional explicit path to a Claude Code executable; null = bundled/auto. */
  claudeCodePath: z.string().nullable(),
  /** The student's study portals (Brightspace, Sulis, Blackboard…), shown on the portal's home. */
  portals: z
    .array(z.object({ name: z.string().trim().min(1).max(100), url: z.url({ protocol: /^https?$/ }) }))
    .max(50),
  /** Which model does which job (src/shared/ai/routing.ts): a preset plus per-task overrides. */
  aiRouting: z.object({
    preset: z.enum(['balanced', 'economy', 'quality']),
    overrides: z
      .array(
        z.object({
          task: routedTaskSchema,
          tier: z.enum(['fast', 'smart']),
          effort: z.enum(['low', 'medium', 'high'])
        })
      )
      .max(20),
    escalate: z.boolean()
  })
})

export type Settings = z.infer<typeof settingsSchema>

/** Settings as the renderer sees them: secrets are never sent, only whether they exist. */
export interface PublicSettings extends Settings {
  hasApiKey: boolean
  /** Whether a key is stored for the OpenAI-compatible server (local servers usually need none). */
  hasOpenAiCompatibleKey: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-code',
  models: {
    'claude-code': { fast: 'haiku', smart: 'opus' },
    'anthropic-api': { fast: 'claude-haiku-5-5', smart: 'claude-opus-5-5' },
    // One model for both tiers: a 24 GB GPU holds one of these at a time, and swapping is slow.
    'openai-compatible': { fast: 'qwen3.6:27b', smart: 'qwen3.6:27b' },
    codex: { fast: 'gpt-6-luna', smart: 'gpt-6.1-sol' }
  },
  openaiBaseUrl: 'http://localhost:11434/v1',
  aiConcurrency: 3,
  contentLanguage: 'auto',
  theme: 'system',
  monthlyBudgetUsd: null,
  prefetchPageChecks: true,
  verifyAnswerKeys: true,
  claudeCodePath: null,
  portals: [],
  aiRouting: DEFAULT_ROUTING
}
