import { RateLimitError } from '@anthropic-ai/sdk'
import type {
  BetaMessage,
  BetaMessageStreamParams,
  BetaRawMessageStreamEvent
} from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { z } from 'zod'
import type { StreamEvent } from '@shared/ai/provider'
import { buildParams, createAnthropicApiProvider, DEFAULT_MAX_TOKENS, type MessageStreamFn } from './provider'

function message(over: Partial<BetaMessage> & { text?: string } = {}): BetaMessage {
  const { text = '{"answer":"ok"}', ...rest } = over
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'claude-opus-5-5',
    content: [
      { type: 'thinking', thinking: '', signature: 's' },
      { type: 'text', text, citations: null }
    ],
    stop_reason: 'end_turn',
    stop_details: null,
    usage: {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 2000,
      cache_creation_input_tokens: 0
    },
    ...rest
  } as unknown as BetaMessage
}

function streamOf(
  final: BetaMessage | Error,
  events: BetaRawMessageStreamEvent[] = []
): { fn: MessageStreamFn; calls: { params: BetaMessageStreamParams; signal?: AbortSignal }[] } {
  const calls: { params: BetaMessageStreamParams; signal?: AbortSignal }[] = []
  const fn: MessageStreamFn = (params, options) => {
    calls.push({ params, ...(options.signal ? { signal: options.signal } : {}) })
    return {
      async *[Symbol.asyncIterator]() {
        yield* events
        if (final instanceof Error) throw final
      },
      finalMessage: async () => {
        if (final instanceof Error) throw final
        return final
      }
    }
  }
  return { fn, calls }
}

const delta = (text: string): BetaRawMessageStreamEvent =>
  ({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text }
  }) as BetaRawMessageStreamEvent

const schema = z.strictObject({ answer: z.string() })
const models = { fast: 'claude-haiku-5-5', smart: 'claude-opus-5-5' }
const request = {
  task: 'cards' as const,
  system: 'SYSTEM',
  parts: [
    { type: 'pdf' as const, path: '/a.pdf', title: 'Pages 1-10' },
    { type: 'pdf' as const, path: '/b.pdf' },
    { type: 'text' as const, text: 'Task: cards' }
  ],
  schema,
  tier: 'smart' as const
}

function provider(fn: MessageStreamFn, apiKey: string | null = 'sk-test') {
  return createAnthropicApiProvider(
    { apiKey, models },
    { stream: fn, readFile: async (p) => new TextEncoder().encode(`%PDF ${p}`), now: () => 0 }
  )
}

describe('buildParams', () => {
  const blocks = [{ type: 'text' as const, text: 'x' }]

  it('sends server-side fallbacks with the beta header on Opus, and an explicit effort', () => {
    const p = buildParams({
      model: 'claude-opus-5-5',
      system: 's',
      blocks,
      effort: undefined,
      schema: null,
      maxTokens: 32000
    })
    expect(p).toMatchObject({
      fallbacks: 'default',
      betas: ['server-side-fallback-2026-07-01'],
      output_config: { effort: 'medium' },
      max_tokens: 32000
    })
    expect(p).not.toHaveProperty('thinking')
  })

  it('sends no fallbacks or betas on Haiku', () => {
    const p = buildParams({
      model: 'claude-haiku-5-5',
      system: 's',
      blocks,
      effort: 'low',
      schema: { type: 'object' },
      maxTokens: 1
    })
    expect(p).not.toHaveProperty('fallbacks')
    expect(p).not.toHaveProperty('betas')
    expect(p.output_config).toEqual({
      effort: 'low',
      format: { type: 'json_schema', schema: { type: 'object' } }
    })
  })
})

describe('anthropic-api provider: generate', () => {
  it('sends documents with a cache breakpoint on the last PDF and structured output config', async () => {
    const { fn, calls } = streamOf(message())
    await provider(fn).generate({ ...request, effort: 'high' })
    const params = calls[0]!.params
    expect(params.model).toBe('claude-opus-5-5')
    expect(params.max_tokens).toBe(DEFAULT_MAX_TOKENS)
    expect(params.system).toBe('SYSTEM')
    const content = params.messages[0]!.content
    expect(Array.isArray(content) && content.map((b) => [b.type, 'cache_control' in b])).toEqual([
      ['document', false],
      ['document', true],
      ['text', false]
    ])
    expect(Array.isArray(content) && content[0]).toMatchObject({
      type: 'document',
      title: 'Pages 1-10',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: Buffer.from('%PDF /a.pdf').toString('base64')
      }
    })
    expect(params.output_config).toMatchObject({ effort: 'high', format: { type: 'json_schema' } })
  })

  it('uses the fast-tier model without fallbacks', async () => {
    const { fn, calls } = streamOf(message({ model: 'claude-haiku-5-5' }))
    await provider(fn).generate({ ...request, tier: 'fast' })
    expect(calls[0]!.params).toMatchObject({ model: 'claude-haiku-5-5' })
    expect(calls[0]!.params).not.toHaveProperty('fallbacks')
  })

  it('returns validated data with computed cost (not notional)', async () => {
    const { fn } = streamOf(message())
    const res = await provider(fn).generate(request)
    expect(res.data).toEqual({ answer: 'ok' })
    expect(res.model).toBe('claude-opus-5-5')
    expect(res.usage).toMatchObject({
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 2000,
      notional: false
    })
    expect(res.usage.costUsd).toBeCloseTo((1000 * 4 + 500 * 20 + 2000 * 0.2) / 1e6)
  })

  it('maps invalid JSON and schema mismatches to retryable invalid_output', async () => {
    await expect(
      provider(streamOf(message({ text: 'not json' })).fn).generate(request)
    ).rejects.toMatchObject({
      kind: 'invalid_output',
      retryable: true
    })
    await expect(
      provider(streamOf(message({ text: '{"answer":1}' })).fn).generate(request)
    ).rejects.toMatchObject({
      kind: 'invalid_output'
    })
  })

  it('maps stop reasons: refusal -> refused, max_tokens -> truncated', async () => {
    const refused = message({
      stop_reason: 'refusal',
      stop_details: { type: 'refusal', category: 'cyber', explanation: null } as BetaMessage['stop_details']
    })
    await expect(provider(streamOf(refused).fn).generate(request)).rejects.toMatchObject({
      kind: 'refused',
      retryable: false
    })
    await expect(
      provider(streamOf(message({ stop_reason: 'max_tokens' })).fn).generate(request)
    ).rejects.toMatchObject({
      kind: 'truncated'
    })
  })

  it('maps typed SDK errors', async () => {
    const limited = new RateLimitError(429, {}, 'rate limited', new Headers({ 'retry-after': '60' }))
    await expect(provider(streamOf(limited).fn).generate(request)).rejects.toMatchObject({
      kind: 'rate_limited',
      resetAt: '1970-01-01T00:01:00.000Z'
    })
  })

  it('fails with auth when no key is configured, without calling the API', async () => {
    const { fn, calls } = streamOf(message())
    await expect(provider(fn, null).generate(request)).rejects.toMatchObject({ kind: 'auth' })
    expect(calls).toHaveLength(0)
    const noKey = createAnthropicApiProvider({ apiKey: null, models })
    expect(await noKey.health()).toMatchObject({ ok: false, provider: 'anthropic-api' })
  })

  it('passes the abort signal to the SDK and refuses an aborted request', async () => {
    const { fn, calls } = streamOf(message())
    const controller = new AbortController()
    await provider(fn).generate({ ...request, signal: controller.signal })
    expect(calls[0]!.signal).toBe(controller.signal)
    await expect(provider(fn).generate({ ...request, signal: AbortSignal.abort() })).rejects.toMatchObject({
      kind: 'cancelled'
    })
  })
})

describe('anthropic-api provider: stream and health', () => {
  it('yields text deltas and a done event', async () => {
    const { fn, calls } = streamOf(message({ text: 'Hello world' }), [delta('Hello'), delta(' world')])
    const events: StreamEvent[] = []
    for await (const e of provider(fn).stream({ ...request })) events.push(e)
    expect(calls[0]!.params.output_config).not.toHaveProperty('format')
    expect(events.map((e) => (e.type === 'text' ? e.text : 'done'))).toEqual(['Hello', ' world', 'done'])
  })

  it('health uses the fast tier at low effort', async () => {
    const { fn, calls } = streamOf(message({ model: 'claude-haiku-5-5', text: '{"ok":true}' }))
    expect(await provider(fn).health()).toMatchObject({ ok: true, model: 'claude-haiku-5-5', latencyMs: 0 })
    expect(calls[0]!.params).toMatchObject({ model: 'claude-haiku-5-5', output_config: { effort: 'low' } })
  })
})
