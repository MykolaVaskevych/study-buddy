import { basename } from 'node:path'
import { z } from 'zod'
import { isLocalUrl, presetFor } from '@shared/ai/connections'
import {
  AiError,
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
import { pumpText } from '../text-pump'
import {
  createThinkFilter,
  documentText,
  extractJson,
  fetchError,
  httpError,
  sseData,
  TEXT_ONLY_NOTE,
  type PageText
} from './wire'

/**
 * Provider for any server that speaks the OpenAI chat-completions API: local ones (Ollama,
 * LM Studio, llama.cpp) and hosted ones (DeepSeek, OpenRouter). These models read text only, so
 * PDF parts are sent as their text layer with SB-PAGE markers; image-only slides are flagged and
 * cannot be read. Structured output asks for `json_schema` first and steps down to `json_object`
 * and then to plain text when a server rejects it, always validating with zod and giving the
 * model one chance to repair invalid JSON.
 */

export type FetchFn = typeof fetch

/** Page texts of a library PDF; the composition root wires it to the PDF library. */
export type PdfTextFn = (path: string) => Promise<readonly PageText[]>

export interface OpenAiCompatibleConfig {
  baseUrl: string
  /** null for servers without auth (local ones). */
  apiKey: string | null
  models: Record<ModelTier, string>
}

export interface OpenAiCompatibleDeps {
  pdfText: PdfTextFn
  fetch?: FetchFn
  now?: () => number
}

type JsonMode = 'json_schema' | 'json_object' | 'none'

interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface ChatResult {
  text: string
  usage: Usage
  model: string
}

const HEALTH_TIMEOUT_MS = 15_000

const trimSlash = (url: string): string => url.replace(/\/+$/, '')

/** Ollama ids carry a tag; an untagged name means ":latest". */
export function sameModel(a: string, b: string): boolean {
  const norm = (m: string): string => (m.includes(':') ? m : `${m}:latest`)
  return a === b || norm(a) === norm(b)
}

/** Model ids the server offers (GET /models), sorted. */
export async function listModels(
  config: Pick<OpenAiCompatibleConfig, 'baseUrl' | 'apiKey'>,
  deps: { fetch?: FetchFn; now?: () => number; signal?: AbortSignal } = {}
): Promise<string[]> {
  const doFetch = deps.fetch ?? fetch
  const base = trimSlash(config.baseUrl)
  const preset = presetFor(base)
  const server = preset.id === 'custom' ? 'the server' : preset.label
  const signal = AbortSignal.any([
    AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    ...(deps.signal ? [deps.signal] : [])
  ])
  let res: Response
  try {
    res = await doFetch(`${base}/models`, { headers: authHeaders(config.apiKey), signal })
  } catch (err) {
    throw fetchError(err, server, base, isLocalUrl(base))
  }
  if (!res.ok)
    throw httpError(res.status, await res.text(), res.headers.get('retry-after'), {
      server,
      model: '',
      pullHint: null,
      now: (deps.now ?? Date.now)()
    })
  const json: unknown = await res.json().catch(() => null)
  const data = (json as { data?: unknown } | null)?.data
  if (!Array.isArray(data)) return []
  return data
    .map((m: unknown) => (m as { id?: unknown } | null)?.id)
    .filter((id): id is string => typeof id === 'string')
    .sort((a, b) => a.localeCompare(b))
}

function authHeaders(apiKey: string | null): Record<string, string> {
  return apiKey === null ? {} : { authorization: `Bearer ${apiKey}` }
}

function responseFormat(mode: JsonMode, schema: Record<string, unknown>): Record<string, unknown> {
  if (mode === 'json_schema')
    return { response_format: { type: 'json_schema', json_schema: { name: 'output', strict: true, schema } } }
  if (mode === 'json_object') return { response_format: { type: 'json_object' } }
  return {}
}

/** Instructions that make plain-text and json_object modes work; harmless with json_schema. */
export function jsonInstruction(schema: Record<string, unknown>): string {
  return [
    'Reply with a single JSON object and nothing else: no prose, no code fences.',
    'It must match this JSON Schema exactly (every listed property, null where it does not apply):',
    JSON.stringify(schema)
  ].join('\n')
}

export function createOpenAiCompatibleProvider(
  config: OpenAiCompatibleConfig,
  deps: OpenAiCompatibleDeps
): LlmProvider {
  const doFetch = deps.fetch ?? fetch
  const now = deps.now ?? Date.now
  const base = trimSlash(config.baseUrl)
  const preset = presetFor(base)
  const local = isLocalUrl(base)
  const server = preset.id === 'custom' ? 'the server' : preset.label
  // Learnt per instance: once a server rejects json_schema, later calls skip straight to what works.
  let jsonMode: JsonMode = 'json_schema'

  async function userText(parts: readonly PromptPart[]): Promise<{ text: string; hasPdf: boolean }> {
    const out: string[] = []
    let hasPdf = false
    for (const part of parts) {
      if (part.type === 'text') {
        out.push(part.text)
        continue
      }
      hasPdf = true
      let pages: readonly PageText[]
      try {
        pages = await deps.pdfText(part.path)
      } catch (cause) {
        throw new AiError('unknown', `Cannot read PDF part ${basename(part.path)}`, {
          retryable: false,
          cause
        })
      }
      out.push(documentText(pages, part.title ?? null))
    }
    return { text: out.join('\n\n'), hasPdf }
  }

  function usageOf(raw: unknown): Usage {
    const u = (raw ?? {}) as {
      prompt_tokens?: unknown
      completion_tokens?: unknown
      prompt_tokens_details?: { cached_tokens?: unknown } | null
    }
    const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
    return {
      inputTokens: num(u.prompt_tokens),
      outputTokens: num(u.completion_tokens),
      cacheReadTokens: num(u.prompt_tokens_details?.cached_tokens),
      cacheWriteTokens: 0,
      // Local runs cost nothing; hosted prices vary by vendor and are not tracked here.
      costUsd: local ? 0 : null,
      notional: local
    }
  }

  /** One streamed chat completion; returns the visible text (reasoning removed). */
  async function chat(
    tier: ModelTier,
    messages: ChatMessage[],
    extra: Record<string, unknown>,
    signal: AbortSignal | undefined,
    onText?: (text: string) => void
  ): Promise<ChatResult> {
    if (signal?.aborted) throw new AiError('cancelled', 'Request cancelled')
    const model = config.models[tier]
    const body = {
      model,
      messages,
      stream: true,
      stream_options: { include_usage: true },
      ...(preset.maxTokens === null ? {} : { max_tokens: preset.maxTokens }),
      ...extra
    }
    let res: Response
    try {
      res = await doFetch(`${base}/chat/completions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(config.apiKey) },
        body: JSON.stringify(body),
        ...(signal === undefined ? {} : { signal })
      })
    } catch (err) {
      throw fetchError(err, server, base, local)
    }
    const pullHint = preset.id === 'ollama' ? `ollama pull ${model}` : null
    if (!res.ok || res.body === null)
      throw httpError(res.status, await res.text(), res.headers.get('retry-after'), {
        server,
        model,
        pullHint,
        now: now()
      })

    const filter = createThinkFilter()
    let text = ''
    let usage: Usage = usageOf(null)
    let served = model
    let finish: string | null = null
    try {
      for await (const data of sseData(res.body)) {
        let chunk: unknown
        try {
          chunk = JSON.parse(data)
        } catch {
          continue
        }
        const c = chunk as {
          error?: unknown
          model?: unknown
          usage?: unknown
          choices?: { delta?: { content?: unknown }; finish_reason?: unknown }[]
        }
        if (c.error !== undefined)
          throw httpError(500, JSON.stringify({ error: c.error }), null, {
            server,
            model,
            pullHint,
            now: now()
          })
        if (typeof c.model === 'string' && c.model !== '') served = c.model
        if (c.usage) usage = usageOf(c.usage)
        const choice = c.choices?.[0]
        if (typeof choice?.finish_reason === 'string') finish = choice.finish_reason
        const delta = choice?.delta?.content
        if (typeof delta === 'string' && delta !== '') {
          const visible = filter.push(delta)
          text += visible
          if (visible !== '') onText?.(visible)
        }
      }
    } catch (err) {
      throw fetchError(err, server, base, local)
    }
    const tail = filter.flush()
    text += tail
    if (tail !== '') onText?.(tail)
    if (finish === 'length')
      throw new AiError('truncated', 'Output was cut off (the model hit its length limit)')
    if (finish === 'content_filter') throw new AiError('refused', 'The model declined this request')
    return { text, usage, model: served }
  }

  /** chat() with response_format, stepping down when the server rejects it (400/422). */
  async function chatJson(
    tier: ModelTier,
    messages: ChatMessage[],
    schema: Record<string, unknown>,
    signal: AbortSignal | undefined
  ): Promise<ChatResult> {
    for (;;) {
      try {
        return await chat(tier, messages, responseFormat(jsonMode, schema), signal)
      } catch (err) {
        const rejected = err instanceof AiError && err.kind === 'unknown' && /\((400|422)\)/.test(err.message)
        if (!rejected || jsonMode === 'none') throw err
        jsonMode = jsonMode === 'json_schema' ? 'json_object' : 'none'
      }
    }
  }

  const addUsage = (a: Usage, b: Usage): Usage => ({
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    cacheReadTokens: a.cacheReadTokens + b.cacheReadTokens,
    cacheWriteTokens: a.cacheWriteTokens + b.cacheWriteTokens,
    costUsd: a.costUsd === null || b.costUsd === null ? null : a.costUsd + b.costUsd,
    notional: a.notional
  })

  async function generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const schema = z.toJSONSchema(req.schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
    const { text, hasPdf } = await userText(req.parts)
    const system = [req.system, ...(hasPdf ? [TEXT_ONLY_NOTE] : []), jsonInstruction(schema)].join('\n\n')
    const messages: ChatMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: text }
    ]
    const first = await chatJson(req.tier, messages, schema, req.signal)
    const attempt = (reply: string): { ok: true; data: T } | { ok: false; problem: string } => {
      try {
        const parsed = req.schema.safeParse(extractJson(reply))
        return parsed.success
          ? { ok: true, data: parsed.data }
          : { ok: false, problem: z.prettifyError(parsed.error) }
      } catch (err) {
        return { ok: false, problem: err instanceof Error ? err.message : String(err) }
      }
    }
    const firstTry = attempt(first.text)
    if (firstTry.ok) return { data: firstTry.data, usage: first.usage, model: first.model }

    // Small models often get one field wrong; showing them the error fixes most cases.
    const repair = await chatJson(
      req.tier,
      [
        ...messages,
        { role: 'assistant', content: first.text.slice(0, 20_000) },
        {
          role: 'user',
          content: `That reply does not match the schema:\n${firstTry.problem.slice(0, 2_000)}\nReply again with only the corrected JSON object.`
        }
      ],
      schema,
      req.signal
    )
    const second = attempt(repair.text)
    if (!second.ok)
      throw new AiError('invalid_output', `Structured output did not match the schema: ${second.problem}`)
    return { data: second.data, usage: addUsage(first.usage, repair.usage), model: repair.model }
  }

  return {
    id: 'openai-compatible',
    capabilities: { promptCaching: false, batch: false, maxPdfPages: 100 },
    generate,

    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const { text, hasPdf } = await userText(req.parts)
      const system = hasPdf ? `${req.system}\n\n${TEXT_ONLY_NOTE}` : req.system
      const result = yield* pumpText(
        (onText, signal) =>
          chat(
            req.tier,
            [
              { role: 'system', content: system },
              { role: 'user', content: text }
            ],
            {},
            signal,
            onText
          ),
        req.signal
      )
      yield { type: 'done', usage: result.usage, model: result.model }
    },

    async health(signal?: AbortSignal): Promise<HealthResult> {
      const fail = (message: string): HealthResult => ({
        ok: false,
        provider: 'openai-compatible',
        model: null,
        latencyMs: null,
        message
      })
      const started = now()
      try {
        const models = await listModels(config, { fetch: doFetch, now, ...(signal ? { signal } : {}) })
        const missing = [...new Set([config.models.fast, config.models.smart])].filter(
          (m) => models.length > 0 && !models.some((id) => sameModel(id, m))
        )
        if (missing.length > 0) {
          const pull =
            preset.id === 'ollama'
              ? ` Install with: ${missing.map((m) => `ollama pull ${m}`).join(' && ')}.`
              : ''
          return fail(
            `${server} does not have ${missing.map((m) => `"${m}"`).join(' or ')}.${pull} Available: ${models.slice(0, 8).join(', ')}${models.length > 8 ? ', ...' : ''}`
          )
        }
        const res = await generate({
          task: 'health',
          system: 'This is a connectivity check. Answer with ok = true.',
          parts: [{ type: 'text', text: 'Connectivity check: set ok to true.' }],
          schema: z.strictObject({ ok: z.boolean() }),
          tier: 'fast',
          effort: 'low',
          signal: AbortSignal.any([AbortSignal.timeout(120_000), ...(signal ? [signal] : [])])
        })
        const latencyMs = now() - started
        return {
          ok: true,
          provider: 'openai-compatible',
          model: res.model,
          latencyMs,
          message: `${server === 'the server' ? 'Server' : server} reachable (${res.model}, ${latencyMs} ms).`
        }
      } catch (err) {
        return fail(err instanceof Error ? err.message : String(err))
      }
    }
  }
}
