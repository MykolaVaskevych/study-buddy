import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import type {
  BetaContentBlockParam,
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import {
  AiError,
  type Effort,
  type GenerateRequest,
  type GenerateResult,
  type HealthResult,
  type LlmProvider,
  type ModelTier,
  type PromptPart,
  type StreamEvent,
  type StreamRequest,
  type Usage
} from '@shared/ai/provider'
import { defaultReadFile, loadParts, type LoadedPart, type ReadFileFn } from '../content'
import { pumpText } from '../text-pump'
import { mapApiError } from './errors'
import { costUsd } from './pricing'

/**
 * Bring-your-own-key provider on the Anthropic Messages API (beta namespace, so Opus calls can
 * opt into server-side refusal fallbacks). Every call streams and waits for the final message,
 * which keeps large outputs clear of HTTP timeouts. Structured outputs use
 * `output_config.format` with a JSON schema derived from the zod schema; the reply is validated
 * with zod here so a mismatch is a retryable `invalid_output`.
 */

/** The one SDK call this provider makes; injectable so tests run without network. */
export type MessageStreamFn = (
  params: BetaMessageStreamParams,
  options: { signal?: AbortSignal }
) => AsyncIterable<BetaRawMessageStreamEvent> & { finalMessage(): Promise<BetaMessage> }

export interface AnthropicApiConfig {
  /** null when no key is stored: every call then fails with `auth`. */
  apiKey: string | null
  models: Record<ModelTier, string>
  maxTokens?: number
}

export interface AnthropicApiDeps {
  stream?: MessageStreamFn
  readFile?: ReadFileFn
  now?: () => number
}

/** Room for long structured outputs plus adaptive thinking (which counts against max_tokens). */
export const DEFAULT_MAX_TOKENS = 32_000
const FALLBACK_BETA = 'server-side-fallback-2026-07-01'
/** Opus 5.5 effort defaults to medium; it is always sent explicitly so behaviour is pinned. */
const DEFAULT_EFFORT: Effort = 'medium'

export function isOpus(model: string): boolean {
  return /opus/i.test(model)
}

function contentBlocks(parts: readonly LoadedPart[]): BetaContentBlockParam[] {
  const lastPdf = parts.map((p) => p.type).lastIndexOf('pdf')
  return parts.map((p, i): BetaContentBlockParam => {
    if (p.type === 'text') return { type: 'text', text: p.text }
    return {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: p.base64 },
      ...(p.title === null ? {} : { title: p.title }),
      // One breakpoint after the documents caches system + PDFs for follow-up calls on the same chunks.
      ...(i === lastPdf ? { cache_control: { type: 'ephemeral' } } : {})
    }
  })
}

/** Request body; exported for tests of the parameter rules (fallbacks, effort, caching). */
export function buildParams(input: {
  model: string
  system: string
  blocks: BetaContentBlockParam[]
  effort: Effort | undefined
  schema: Record<string, unknown> | null
  maxTokens: number
}): BetaMessageStreamParams {
  const opus = isOpus(input.model)
  return {
    model: input.model,
    max_tokens: input.maxTokens,
    system: input.system,
    messages: [{ role: 'user', content: input.blocks }],
    // No `thinking` param: Opus 5.5 cannot disable it and budgets are rejected; effort is the control.
    output_config: {
      effort: input.effort ?? DEFAULT_EFFORT,
      ...(input.schema === null ? {} : { format: { type: 'json_schema', schema: input.schema } })
    },
    ...(opus ? { fallbacks: 'default', betas: [FALLBACK_BETA] } : {})
  }
}

export function usageFromMessage(message: BetaMessage, requestedModel: string): Usage {
  const tokens = {
    inputTokens: message.usage.input_tokens,
    outputTokens: message.usage.output_tokens,
    cacheReadTokens: message.usage.cache_read_input_tokens ?? 0,
    cacheWriteTokens: message.usage.cache_creation_input_tokens ?? 0
  }
  // A fallback model may have served the call; price by it when known, else by the requested one.
  const cost = costUsd(message.model, tokens) ?? costUsd(requestedModel, tokens)
  return { ...tokens, costUsd: cost, notional: false }
}

/** Throws for stop reasons that mean the output is unusable. */
export function checkStopReason(message: BetaMessage): void {
  if (message.stop_reason === 'refusal') {
    const category = message.stop_details?.category ?? null
    throw new AiError(
      'refused',
      `The model declined this request${category === null ? '' : ` (${category})`}`
    )
  }
  if (message.stop_reason === 'max_tokens' || message.stop_reason === 'model_context_window_exceeded')
    throw new AiError('truncated', `Output was cut off (${message.stop_reason})`)
}

function textOf(message: BetaMessage): string {
  return message.content.map((block) => (block.type === 'text' ? block.text : '')).join('')
}

/** Parses and validates the JSON reply; any mismatch is a retryable invalid_output. */
export function parseStructured<T>(message: BetaMessage, schema: z.ZodType<T>): T {
  let json: unknown
  try {
    json = JSON.parse(textOf(message))
  } catch {
    throw new AiError('invalid_output', 'The model did not return valid JSON')
  }
  const parsed = schema.safeParse(json)
  if (!parsed.success)
    throw new AiError(
      'invalid_output',
      `Structured output did not match the schema: ${z.prettifyError(parsed.error)}`
    )
  return parsed.data
}

/** The real SDK call. The key lives only inside the client; it is never logged or put in messages. */
function sdkStream(apiKey: string): MessageStreamFn {
  const client = new Anthropic({ apiKey })
  return (params, options) => client.beta.messages.stream(params, options)
}

export function createAnthropicApiProvider(
  config: AnthropicApiConfig,
  deps: AnthropicApiDeps = {}
): LlmProvider {
  const readFile = deps.readFile ?? defaultReadFile
  const now = deps.now ?? Date.now
  const maxTokens = config.maxTokens ?? DEFAULT_MAX_TOKENS
  const apiKey = config.apiKey
  // No key, no calls: even an injected stream is never used without one.
  const streamFn: MessageStreamFn | null = apiKey === null ? null : (deps.stream ?? sdkStream(apiKey))

  async function call(
    req: {
      system: string
      parts: readonly PromptPart[]
      tier: ModelTier
      effort?: Effort
      signal?: AbortSignal
    },
    schema: Record<string, unknown> | null,
    onText?: (text: string) => void
  ): Promise<{ message: BetaMessage; model: string }> {
    if (streamFn === null) throw new AiError('auth', 'No Anthropic API key is configured')
    if (req.signal?.aborted) throw new AiError('cancelled', 'Request cancelled')
    const model = config.models[req.tier]
    try {
      const params = buildParams({
        model,
        system: req.system,
        blocks: contentBlocks(await loadParts(req.parts, readFile)),
        effort: req.effort,
        schema,
        maxTokens
      })
      const stream = streamFn(params, req.signal === undefined ? {} : { signal: req.signal })
      if (onText) {
        for await (const event of stream)
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta')
            onText(event.delta.text)
      }
      const message = await stream.finalMessage()
      checkStopReason(message)
      return { message, model }
    } catch (err) {
      throw mapApiError(err, now())
    }
  }

  async function generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    // The SDK helper adapts the zod JSON schema to what structured outputs accept.
    const { schema } = betaZodOutputFormat(req.schema)
    const { message, model } = await call(req, schema)
    return {
      data: parseStructured(message, req.schema),
      usage: usageFromMessage(message, model),
      model: message.model
    }
  }

  return {
    id: 'anthropic-api',
    capabilities: { promptCaching: true, batch: false, maxPdfPages: 100 },
    generate,

    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const { message, model } = yield* pumpText(
        (onText, signal) => call({ ...req, signal }, null, onText),
        req.signal
      )
      yield { type: 'done', usage: usageFromMessage(message, model), model: message.model }
    },

    async health(signal?: AbortSignal): Promise<HealthResult> {
      const started = now()
      try {
        const res = await generate({
          task: 'health',
          system: 'This is a connectivity check. Answer with ok = true.',
          parts: [{ type: 'text', text: 'Connectivity check: set ok to true.' }],
          schema: z.strictObject({ ok: z.boolean() }),
          tier: 'fast',
          effort: 'low',
          ...(signal === undefined ? {} : { signal })
        })
        const latencyMs = now() - started
        return {
          ok: true,
          provider: 'anthropic-api',
          model: res.model,
          latencyMs,
          message: `Anthropic API reachable (${res.model}, ${latencyMs} ms).`
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        return { ok: false, provider: 'anthropic-api', model: null, latencyMs: null, message }
      }
    }
  }
}
