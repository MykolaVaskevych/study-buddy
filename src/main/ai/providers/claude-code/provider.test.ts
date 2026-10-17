import {
  AbortError,
  type Options,
  type SDKMessage,
  type SDKUserMessage
} from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { AiError, type StreamEvent } from '@shared/ai/provider'
import { createClaudeCodeProvider, subscriptionEnv, type QueryFn } from './provider'
import { assistantText, initMessage, rateLimitEvent, successResult, textDelta } from './test-messages'

interface Captured {
  options: Options | null
  prompt: SDKUserMessage[]
  closed: boolean
}

/** A QueryFn that replays messages; `script` may wait on the abort controller. */
function scripted(script: SDKMessage[] | ((options: Options) => AsyncGenerator<SDKMessage>)): {
  query: QueryFn
  captured: Captured
} {
  const captured: Captured = { options: null, prompt: [], closed: false }
  const query: QueryFn = ({ prompt, options }) => {
    captured.options = options
    async function* run(): AsyncGenerator<SDKMessage> {
      for await (const m of prompt) captured.prompt.push(m)
      if (Array.isArray(script)) yield* script
      else yield* script(options)
    }
    return Object.assign(run(), { close: () => void (captured.closed = true) })
  }
  return { query, captured }
}

const schema = z.strictObject({ answer: z.string() })
const models = { fast: 'haiku', smart: 'opus' }
const pdfBytes = new TextEncoder().encode('%PDF-1.7 fake')

function provider(query: QueryFn, over: { executablePath?: string | null; timeoutMs?: number } = {}) {
  return createClaudeCodeProvider(
    {
      models,
      executablePath: over.executablePath ?? null,
      ...(over.timeoutMs ? { timeoutMs: over.timeoutMs } : {})
    },
    {
      query,
      readFile: async () => pdfBytes,
      env: { PATH: '/usr/bin', HOME: '/home/u', ANTHROPIC_API_KEY: 'sk-secret', ANTHROPIC_AUTH_TOKEN: 't' },
      now: () => Date.UTC(2026, 9, 17, 10, 0)
    }
  )
}

const request = {
  task: 'index' as const,
  system: 'SYSTEM',
  parts: [
    { type: 'pdf' as const, path: '/lib/chunk-0.pdf', title: 'Pages 1-10' },
    { type: 'text' as const, text: 'Focus pages: 1-10' }
  ],
  schema,
  tier: 'smart' as const,
  effort: 'medium' as const
}

describe('claude-code provider: generate', () => {
  it('runs the runtime as a plain, isolated model call', async () => {
    const { query, captured } = scripted([
      initMessage(),
      successResult({ structured_output: { answer: 'x' } })
    ])
    await provider(query, { executablePath: '/opt/claude' }).generate(request)
    const o = captured.options
    expect(o).toMatchObject({
      model: 'opus',
      effort: 'medium',
      tools: [],
      settingSources: [],
      strictMcpConfig: true,
      mcpServers: {},
      persistSession: false,
      systemPrompt: 'SYSTEM',
      maxTurns: 3,
      pathToClaudeCodeExecutable: '/opt/claude',
      outputFormat: { type: 'json_schema' }
    })
    // The runtime's validator rejects zod's draft 2020-12 meta-schema reference.
    expect(o?.outputFormat?.schema).not.toHaveProperty('$schema')
    expect(o?.outputFormat?.schema).toMatchObject({
      type: 'object',
      required: ['answer'],
      additionalProperties: false
    })
    expect(o?.abortController).toBeInstanceOf(AbortController)
    expect(o?.includePartialMessages).toBeUndefined()
    expect(captured.closed).toBe(true)
  })

  it('removes API credentials from the runtime environment', async () => {
    const { query, captured } = scripted([successResult({ structured_output: { answer: 'x' } })])
    await provider(query).generate(request)
    expect(captured.options?.env).toMatchObject({ PATH: '/usr/bin', HOME: '/home/u' })
    expect(captured.options?.env).not.toHaveProperty('ANTHROPIC_API_KEY')
    expect(captured.options?.env).not.toHaveProperty('ANTHROPIC_AUTH_TOKEN')
    expect(subscriptionEnv({ ANTHROPIC_API_KEY: 'k' })).toEqual({
      CLAUDE_AGENT_SDK_CLIENT_APP: 'study-buddy/0.1'
    })
  })

  it('sends PDFs as base64 document blocks in one client-composed user message', async () => {
    const { query, captured } = scripted([successResult({ structured_output: { answer: 'x' } })])
    await provider(query).generate(request)
    expect(captured.prompt).toHaveLength(1)
    expect(captured.prompt[0]).toMatchObject({
      type: 'user',
      parent_tool_use_id: null,
      client_composed: true,
      message: {
        role: 'user',
        content: [
          {
            type: 'document',
            title: 'Pages 1-10',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: Buffer.from(pdfBytes).toString('base64')
            }
          },
          { type: 'text', text: 'Focus pages: 1-10' }
        ]
      }
    })
  })

  it('returns validated data with usage across models and notional cost', async () => {
    const { query } = scripted([
      initMessage('claude-opus-5-5'),
      successResult({ structured_output: { answer: 'ok' } })
    ])
    const res = await provider(query).generate(request)
    expect(res).toEqual({
      data: { answer: 'ok' },
      model: 'claude-opus-5-5',
      usage: {
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadTokens: 400,
        cacheWriteTokens: 50,
        costUsd: 0.0123,
        notional: true
      }
    })
  })

  it('falls back to JSON in the result text when structured_output is absent', async () => {
    const { query } = scripted([successResult({ result: '{"answer":"from text"}' })])
    expect((await provider(query).generate(request)).data).toEqual({ answer: 'from text' })
  })

  it('throws retryable invalid_output when the output does not match the schema', async () => {
    const { query } = scripted([successResult({ structured_output: { answer: 42 } })])
    const err = await provider(query)
      .generate(request)
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(AiError)
    expect(err).toMatchObject({ kind: 'invalid_output', retryable: true })
  })

  it('maps a subscription limit to rate_limited with the reset time', async () => {
    const { query, captured } = scripted([
      initMessage(),
      rateLimitEvent({ status: 'rejected', resetsAt: 1792260000, rateLimitType: 'five_hour' }),
      assistantText("You've hit your session limit · resets 5pm (Europe/Kyiv)", 'rate_limit'),
      successResult({ is_error: true, result: "You've hit your session limit · resets 5pm (Europe/Kyiv)" })
    ])
    await expect(provider(query).generate(request)).rejects.toMatchObject({
      kind: 'rate_limited',
      resetAt: new Date(1792260000 * 1000).toISOString()
    })
    expect(captured.closed).toBe(true)
  })

  it('maps a missing runtime to unavailable', async () => {
    const query: QueryFn = () => {
      async function* fail(): AsyncGenerator<SDKMessage> {
        yield* []
        throw new ReferenceError('Claude Code native binary not found at /nope.')
      }
      return Object.assign(fail(), { close: () => undefined })
    }
    await expect(provider(query).generate(request)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: false
    })
  })

  it('fails when the runtime ends without a result', async () => {
    const { query } = scripted([initMessage()])
    await expect(provider(query).generate(request)).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('maps an unreadable PDF to a non-retryable error', async () => {
    const { query } = scripted([successResult()])
    const p = createClaudeCodeProvider(
      { models, executablePath: null },
      {
        query,
        readFile: async () => {
          throw new Error('ENOENT')
        }
      }
    )
    await expect(p.generate(request)).rejects.toMatchObject({ kind: 'unknown', retryable: false })
  })

  it('cancels through the abort signal', async () => {
    const controller = new AbortController()
    const { query, captured } = scripted(async function* (options) {
      controller.abort()
      await new Promise((r) => setTimeout(r, 0))
      if (options.abortController?.signal.aborted) throw new AbortError('Claude Code process aborted by user')
      yield successResult()
    })
    await expect(provider(query).generate({ ...request, signal: controller.signal })).rejects.toMatchObject({
      kind: 'cancelled'
    })
    expect(captured.closed).toBe(true)
  })

  it('does not start when the signal is already aborted', async () => {
    const { query, captured } = scripted([successResult()])
    await expect(provider(query).generate({ ...request, signal: AbortSignal.abort() })).rejects.toMatchObject(
      {
        kind: 'cancelled'
      }
    )
    expect(captured.options).toBeNull()
  })

  it('times out a hung runtime as retryable unavailable', async () => {
    const { query } = scripted(async function* (options) {
      yield initMessage()
      await new Promise<void>((resolve) =>
        options.abortController?.signal.addEventListener('abort', () => resolve())
      )
      throw new AbortError('Claude Code process aborted by user')
    })
    await expect(provider(query, { timeoutMs: 20 }).generate(request)).rejects.toMatchObject({
      kind: 'unavailable',
      retryable: true
    })
  })
})

describe('claude-code provider: stream', () => {
  it('yields text deltas, then done with usage', async () => {
    const { query, captured } = scripted([
      initMessage('claude-opus-5-5'),
      textDelta('Hello'),
      textDelta(' world'),
      assistantText('Hello world'),
      successResult({ result: 'Hello world' })
    ])
    const events: StreamEvent[] = []
    for await (const e of provider(query).stream({ ...request })) events.push(e)
    expect(captured.options?.includePartialMessages).toBe(true)
    expect(captured.options?.outputFormat).toBeUndefined()
    expect(events.slice(0, 2)).toEqual([
      { type: 'text', text: 'Hello' },
      { type: 'text', text: ' world' }
    ])
    expect(events[2]).toMatchObject({ type: 'done', model: 'claude-opus-5-5', usage: { costUsd: 0.0123 } })
    expect(events).toHaveLength(3)
  })

  it('falls back to whole assistant text blocks without partial messages', async () => {
    const { query } = scripted([assistantText('All at once'), successResult({ result: 'All at once' })])
    const texts: string[] = []
    for await (const e of provider(query).stream({ ...request })) if (e.type === 'text') texts.push(e.text)
    expect(texts).toEqual(['All at once'])
  })

  it('throws mapped errors to the consumer', async () => {
    const { query } = scripted([
      assistantText('Not logged in · Please run /login', 'authentication_failed'),
      successResult({ is_error: true, result: 'Not logged in · Please run /login' })
    ])
    const consume = async (): Promise<void> => {
      for await (const _ of provider(query).stream({ ...request })) void _
    }
    await expect(consume()).rejects.toMatchObject({ kind: 'auth' })
  })
})

describe('claude-code provider: health', () => {
  it('reports the model, latency and an API-key billing warning', async () => {
    const { query, captured } = scripted([
      initMessage('claude-haiku-5-5', 'ANTHROPIC_API_KEY'),
      successResult({ structured_output: { ok: true } })
    ])
    const health = await provider(query).health()
    expect(captured.options).toMatchObject({ model: 'haiku', effort: 'low' })
    expect(health).toMatchObject({
      ok: true,
      provider: 'claude-code',
      model: 'claude-haiku-5-5',
      latencyMs: 0
    })
    expect(health.message).toContain('API key')
  })

  it('explains a missing login', async () => {
    const { query } = scripted([
      assistantText('Not logged in · Please run /login', 'authentication_failed'),
      successResult({ is_error: true, result: 'Not logged in · Please run /login' })
    ])
    const health = await provider(query).health()
    expect(health).toMatchObject({ ok: false, model: null, latencyMs: null })
    expect(health.message).toContain('/login')
  })
})
