/**
 * Public surface of the AI module for the composition root. Everything else in src/main/ai is
 * internal; other modules depend only on the contracts in ./types and @shared/ai/provider.
 */
export { createStudyAi, type StudyAiOptions } from './study-ai'
export {
  createProvider,
  createAnthropicApiProvider,
  createClaudeCodeProvider,
  createFakeProvider,
  createClaudeAuth,
  createOpenAiCompatibleProvider,
  findClaudeExecutable,
  listModels,
  type ClaudeAuth,
  type PdfTextFn
} from './providers'
export type * from './types'
