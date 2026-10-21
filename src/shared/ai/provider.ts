import type { z } from 'zod'

/**
 * Provider-neutral LLM contract. Implementations live in src/main/ai/providers.
 *  - 'claude-code'   : the user's Claude subscription via the local Claude Code runtime (Agent SDK)
 *  - 'anthropic-api' : bring-your-own Anthropic API key
 *  - 'openai-compatible' : any server speaking the OpenAI chat API (Ollama, LM Studio, DeepSeek, ...)
 *  - 'fake'          : deterministic provider for tests and the smoke run
 */
export type ProviderId = 'claude-code' | 'anthropic-api' | 'openai-compatible' | 'fake'

/** 'fast' = bulk/cheap work (indexing), 'smart' = generation, grading, chat. */
export type ModelTier = 'fast' | 'smart'

export type Effort = 'low' | 'medium' | 'high'

/** What the call is for; used for cost accounting and logging. */
export type AiTask =
  | 'index'
  | 'topics'
  | 'cards'
  | 'questions'
  | 'page_check'
  | 'grade'
  | 'verify'
  | 'explain'
  | 'chat'
  | 'past_paper'
  | 'lesson'
  | 'naming'
  | 'portal'
  | 'health'

export type PromptPart =
  | { type: 'text'; text: string }
  /**
   * A PDF file on disk (usually a chunk produced by the library). The model receives both the
   * text layer and an image of each page. Chunk pages carry a visible "SB-PAGE <n>" stamp with
   * the absolute page number.
   */
  | { type: 'pdf'; path: string; title?: string }

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  /** Dollar cost reported or computed for the call; null if unknown. */
  costUsd: number | null
  /** True when the cost is informational only (subscription). */
  notional: boolean
}

export interface GenerateRequest<T> {
  task: AiTask
  system: string
  parts: PromptPart[]
  /** Output is validated against this schema; build it with z.strictObject and .nullable(), never .optional(). */
  schema: z.ZodType<T>
  tier: ModelTier
  effort?: Effort
  signal?: AbortSignal
}

export interface GenerateResult<T> {
  data: T
  usage: Usage
  model: string
}

export interface StreamRequest {
  task: AiTask
  system: string
  parts: PromptPart[]
  tier: ModelTier
  effort?: Effort
  signal?: AbortSignal
}

export type StreamEvent = { type: 'text'; text: string } | { type: 'done'; usage: Usage; model: string }

export interface HealthResult {
  ok: boolean
  provider: ProviderId
  model: string | null
  latencyMs: number | null
  message: string
}

export interface ProviderCapabilities {
  promptCaching: boolean
  batch: boolean
  /** Max pages accepted in one PDF part. */
  maxPdfPages: number
}

export interface LlmProvider {
  readonly id: ProviderId
  readonly capabilities: ProviderCapabilities
  generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>>
  stream(req: StreamRequest): AsyncIterable<StreamEvent>
  health(signal?: AbortSignal): Promise<HealthResult>
}

export type AiErrorKind =
  | 'rate_limited'
  | 'auth'
  | 'refused'
  | 'truncated'
  | 'invalid_output'
  | 'network'
  | 'cancelled'
  | 'unavailable'
  | 'unknown'

/** The only error type providers throw. */
export class AiError extends Error {
  readonly kind: AiErrorKind
  readonly retryable: boolean
  /** For rate limits: ISO time when requests may resume, if known. */
  readonly resetAt: string | null

  constructor(
    kind: AiErrorKind,
    message: string,
    opts: { retryable?: boolean; resetAt?: string | null; cause?: unknown } = {}
  ) {
    super(message, { cause: opts.cause })
    this.name = 'AiError'
    this.kind = kind
    this.retryable =
      opts.retryable ?? (kind === 'network' || kind === 'unavailable' || kind === 'invalid_output')
    this.resetAt = opts.resetAt ?? null
  }
}
