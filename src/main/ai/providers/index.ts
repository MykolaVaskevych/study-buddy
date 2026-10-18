import type { LlmProvider } from '@shared/ai/provider'
import type { Settings } from '@shared/settings'
import { createAnthropicApiProvider } from './anthropic-api/provider'
import { createClaudeCodeProvider } from './claude-code/provider'
import { createFakeProvider } from './fake/provider'
import { findClaudeExecutable } from './claude-code/locate'
import { createOpenAiCompatibleProvider, type PdfTextFn } from './openai-compatible/provider'

/**
 * Provider factory used by the composition root. Model ids come from settings per provider and
 * tier. A missing API key does not throw here: the anthropic-api provider then fails every call
 * with AiError('auth'), which the UI can explain, instead of crashing startup.
 */
export function createProvider(
  settings: Settings,
  secrets: { apiKey: string | null },
  deps: { pdfText: PdfTextFn }
): LlmProvider {
  switch (settings.provider) {
    case 'claude-code':
      return createClaudeCodeProvider({
        models: settings.models['claude-code'],
        executablePath: settings.claudeCodePath ?? findClaudeExecutable()
      })
    case 'anthropic-api':
      return createAnthropicApiProvider({ apiKey: secrets.apiKey, models: settings.models['anthropic-api'] })
    case 'openai-compatible':
      return createOpenAiCompatibleProvider(
        {
          baseUrl: settings.openaiBaseUrl,
          apiKey: secrets.apiKey,
          models: settings.models['openai-compatible']
        },
        { pdfText: deps.pdfText }
      )
    case 'fake':
      return createFakeProvider()
  }
}

export { createAnthropicApiProvider } from './anthropic-api/provider'
export { createClaudeCodeProvider } from './claude-code/provider'
export { createFakeProvider } from './fake/provider'
export { createClaudeAuth, type ClaudeAuth } from './claude-code/auth'
export { findClaudeExecutable } from './claude-code/locate'
export { createOpenAiCompatibleProvider, listModels, type PdfTextFn } from './openai-compatible/provider'
