import { z } from 'zod'

export const providerIdSchema = z.enum(['claude-code', 'anthropic-api', 'fake'])

const tierModelsSchema = z.object({ fast: z.string().min(1), smart: z.string().min(1) })

export const settingsSchema = z.object({
  provider: providerIdSchema,
  /** Model ids per provider and tier. Claude Code accepts aliases such as 'haiku' / 'opus'. */
  models: z.object({
    'claude-code': tierModelsSchema,
    'anthropic-api': tierModelsSchema
  }),
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
  claudeCodePath: z.string().nullable()
})

export type Settings = z.infer<typeof settingsSchema>

/** Settings as the renderer sees them: secrets are never sent, only whether they exist. */
export interface PublicSettings extends Settings {
  hasApiKey: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  provider: 'claude-code',
  models: {
    'claude-code': { fast: 'haiku', smart: 'opus' },
    'anthropic-api': { fast: 'claude-haiku-5-5', smart: 'claude-opus-5-5' }
  },
  aiConcurrency: 3,
  contentLanguage: 'auto',
  theme: 'system',
  monthlyBudgetUsd: null,
  prefetchPageChecks: true,
  verifyAnswerKeys: true,
  claudeCodePath: null
}
