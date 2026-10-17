import {
  query as sdkQuery,
  type ApiKeySource,
  type Options,
  type SDKMessage,
  type SDKResultSuccess,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
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
import { appendStderr, errorFromResult, errorFromThrown, newRunState, observeMessage } from './errors'

/**
 * Provider backed by the user's Claude subscription through the local Claude Code runtime
 * (Agent SDK `query()`). The runtime is used as a plain model call: no tools, no settings files,
 * no MCP servers, no persisted session. PDFs go in as base64 `document` blocks of a single
 * streamed user message, and `outputFormat: json_schema` returns `structured_output`.
 */

export type QueryFn = (params: {
  prompt: AsyncIterable<SDKUserMessage>
  options: Options
}) => AsyncIterable<SDKMessage> & { close(): void }

export interface ClaudeCodeConfig {
  /** Model per tier; Claude Code accepts aliases such as 'haiku' and 'opus'. */
  models: Record<ModelTier, string>
  /** Explicit Claude Code executable; null uses the runtime bundled with the SDK. */
  executablePath: string | null
  /** Hard limit per call; the runtime is killed and the call fails as `unavailable`. Default 15 min. */
  timeoutMs?: number
}

export interface ClaudeCodeDeps {
  query?: QueryFn
  readFile?: ReadFileFn
  /** Base environment for the runtime (default `process.env`). */
  env?: NodeJS.ProcessEnv
  now?: () => number
}

const DEFAULT_TIMEOUT_MS = 15 * 60_000
/** Structured output is delivered through an internal tool call, so it needs a few turns. */
const MAX_TURNS = 3
const CLIENT_APP = 'study-buddy/0.1'
/** Credentials that would make the runtime bill an API account instead of the subscription. */
const API_CREDENTIAL_VARS = ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'] as const
const API_KEY_SOURCES: ReadonlySet<ApiKeySource> = new Set([
  'ANTHROPIC_API_KEY',
  'apiKeyHelper',
  '/login managed key'
])

/** The environment minus API credentials, so the runtime always uses the Claude login. */
export function subscriptionEnv(base: NodeJS.ProcessEnv): Record<string, string | undefined> {
  const blocked: ReadonlySet<string> = new Set(API_CREDENTIAL_VARS)
  return {
    ...Object.fromEntries(Object.entries(base).filter(([name]) => !blocked.has(name))),
    CLAUDE_AGENT_SDK_CLIENT_APP: CLIENT_APP
  }
}

function toUserMessage(parts: readonly LoadedPart[]): SDKUserMessage {
  const content: Exclude<SDKUserMessage['message']['content'], string> = parts.map((p) =>
    p.type === 'text'
      ? { type: 'text', text: p.text }
      : {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: p.base64 },
          ...(p.title === null ? {} : { title: p.title })
        }
  )
  // client_composed: the prompt is assembled from PDF text, so no @-mention or slash-command expansion.
  return { type: 'user', parent_tool_use_id: null, client_composed: true, message: { role: 'user', content } }
}

async function* single(message: SDKUserMessage): AsyncIterable<SDKUserMessage> {
  yield message
}

/** Usage across every model call of the query (modelUsage), falling back to the main loop's usage. */
export function usageFromResult(result: SDKResultSuccess): Usage {
  const perModel = Object.values(result.modelUsage)
  const sum = (pick: (u: (typeof perModel)[number]) => number): number =>
    perModel.reduce((acc, u) => acc + pick(u), 0)
  const tokens =
    perModel.length > 0
      ? {
          inputTokens: sum((u) => u.inputTokens),
          outputTokens: sum((u) => u.outputTokens),
          cacheReadTokens: sum((u) => u.cacheReadInputTokens),
          cacheWriteTokens: sum((u) => u.cacheCreationInputTokens)
        }
      : {
          inputTokens: result.usage.input_tokens,
          outputTokens: result.usage.output_tokens,
          cacheReadTokens: result.usage.cache_read_input_tokens,
          cacheWriteTokens: result.usage.cache_creation_input_tokens
        }
  const cost = result.total_cost_usd
  return { ...tokens, costUsd: Number.isFinite(cost) ? cost : null, notional: true }
}

function modelOf(result: SDKResultSuccess, initModel: string | null, alias: string): string {
  const first = Object.entries(result.modelUsage)[0]
  return initModel ?? first?.[1].canonicalModel ?? first?.[0] ?? alias
}

/**
 * JSON schema for `outputFormat`. The runtime validates it with a validator that does not know
 * the draft 2020-12 meta-schema zod declares in `$schema` (the CLI exits with "not a valid JSON
 * Schema"), so that key is dropped; the schemas themselves use only basic keywords.
 */
export function outputSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _metaSchema, ...rest } = z.toJSONSchema(schema)
  return rest
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

interface RunRequest {
  system: string
  parts: readonly PromptPart[]
  tier: ModelTier
  effort?: Effort
  signal?: AbortSignal
  schema?: Record<string, unknown>
  onText?: (text: string) => void
}

interface RunOutcome {
  result: SDKResultSuccess
  model: string
  apiKeySource: ApiKeySource | null
}

/** health() also warns when the runtime billed an API key instead of the subscription. */
export function createClaudeCodeProvider(config: ClaudeCodeConfig, deps: ClaudeCodeDeps = {}): LlmProvider {
  const queryFn: QueryFn = deps.query ?? sdkQuery
  const readFile = deps.readFile ?? defaultReadFile
  const now = deps.now ?? Date.now
  const timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS

  async function run(req: RunRequest): Promise<RunOutcome> {
    if (req.signal?.aborted) throw new AiError('cancelled', 'Request cancelled')
    const message = toUserMessage(await loadParts(req.parts, readFile))
    const state = newRunState()
    const controller = new AbortController()
    let timedOut = false
    const onAbort = (): void => controller.abort()
    req.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      controller.abort()
    }, timeoutMs)

    const alias = config.models[req.tier]
    const options: Options = {
      model: alias,
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      persistSession: false,
      systemPrompt: req.system,
      maxTurns: MAX_TURNS,
      env: subscriptionEnv(deps.env ?? process.env),
      abortController: controller,
      stderr: (chunk) => appendStderr(state, chunk),
      ...(req.schema === undefined ? {} : { outputFormat: { type: 'json_schema', schema: req.schema } }),
      ...(req.effort === undefined ? {} : { effort: req.effort }),
      ...(req.onText === undefined ? {} : { includePartialMessages: true }),
      ...(config.executablePath === null ? {} : { pathToClaudeCodeExecutable: config.executablePath })
    }

    const q = queryFn({ prompt: single(message), options })
    let initModel: string | null = null
    let apiKeySource: ApiKeySource | null = null
    let streamedText = false
    try {
      for await (const msg of q) {
        observeMessage(state, msg)
        if (msg.type === 'system' && msg.subtype === 'init') {
          initModel = msg.model
          apiKeySource = msg.apiKeySource
        } else if (msg.type === 'stream_event' && msg.parent_tool_use_id === null && req.onText) {
          const event = msg.event
          if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
            streamedText = true
            req.onText(event.delta.text)
          }
        } else if (
          msg.type === 'assistant' &&
          msg.parent_tool_use_id === null &&
          req.onText &&
          !streamedText
        ) {
          // Runtimes without partial messages still deliver whole text blocks.
          for (const block of msg.message.content) if (block.type === 'text') req.onText(block.text)
        } else if (msg.type === 'result') {
          const failure = errorFromResult(msg, state, now())
          if (failure !== null) throw failure
          if (msg.subtype === 'success')
            return { result: msg, model: modelOf(msg, initModel, alias), apiKeySource }
        }
      }
      throw new AiError('unavailable', 'Claude Code ended without a result')
    } catch (err) {
      throw errorFromThrown(
        err,
        state,
        { aborted: req.signal?.aborted ?? false, timedOutAfterMs: timedOut ? timeoutMs : null },
        now()
      )
    } finally {
      clearTimeout(timer)
      req.signal?.removeEventListener('abort', onAbort)
      q.close()
    }
  }

  async function generateWithSource<T>(
    req: GenerateRequest<T>
  ): Promise<GenerateResult<T> & { apiKeySource: ApiKeySource | null }> {
    const outcome = await run({ ...req, schema: outputSchema(req.schema) })
    const { result } = outcome
    const candidate = result.structured_output ?? parseJson(result.result)
    const parsed = req.schema.safeParse(candidate)
    if (!parsed.success)
      throw new AiError(
        'invalid_output',
        `Structured output did not match the schema: ${z.prettifyError(parsed.error)}`
      )
    return {
      data: parsed.data,
      usage: usageFromResult(result),
      model: outcome.model,
      apiKeySource: outcome.apiKeySource
    }
  }

  return {
    id: 'claude-code',
    capabilities: { promptCaching: true, batch: false, maxPdfPages: 100 },

    async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const { data, usage, model } = await generateWithSource(req)
      return { data, usage, model }
    },

    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      // Fields are picked explicitly: a stream never asks for structured output.
      const outcome = yield* pumpText(
        (onText, signal) =>
          run({
            system: req.system,
            parts: req.parts,
            tier: req.tier,
            signal,
            onText,
            ...(req.effort === undefined ? {} : { effort: req.effort })
          }),
        req.signal
      )
      yield { type: 'done', usage: usageFromResult(outcome.result), model: outcome.model }
    },

    async health(signal?: AbortSignal): Promise<HealthResult> {
      const started = now()
      try {
        const res = await generateWithSource({
          task: 'health',
          system: 'This is a connectivity check. Answer with ok = true.',
          parts: [{ type: 'text', text: 'Connectivity check: set ok to true.' }],
          schema: z.strictObject({ ok: z.boolean() }),
          tier: 'fast',
          effort: 'low',
          ...(signal === undefined ? {} : { signal })
        })
        const latencyMs = now() - started
        const billing =
          res.apiKeySource !== null && API_KEY_SOURCES.has(res.apiKeySource)
            ? ` Warning: Claude Code used an API key (${res.apiKeySource}), not the subscription.`
            : ''
        return {
          ok: true,
          provider: 'claude-code',
          model: res.model,
          latencyMs,
          message: `Claude subscription reachable (${res.model}, ${latencyMs} ms).${billing}`
        }
      } catch (err) {
        return {
          ok: false,
          provider: 'claude-code',
          model: null,
          latencyMs: null,
          message: healthMessage(err)
        }
      }
    }
  }
}

/** Short, actionable text for the settings screen. */
export function healthMessage(err: unknown): string {
  if (!(err instanceof AiError)) return err instanceof Error ? err.message : String(err)
  switch (err.kind) {
    case 'auth':
      return `Not signed in to Claude: run \`claude\` in a terminal and use /login. (${err.message})`
    case 'rate_limited':
      return err.resetAt === null ? err.message : `${err.message} (resets ${err.resetAt})`
    case 'unavailable':
      return `Claude Code is not available: ${err.message}`
    default:
      return err.message
  }
}
