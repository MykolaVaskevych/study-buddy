import { z } from 'zod'
import { createOpenAiCompatibleProvider, listModels, sameModel, type FetchFn } from './provider'

interface Call {
  url: string
  body: Record<string, unknown> | null
  auth: string | null
}

/** A fake server: each call takes the next reply. Strings are streamed as SSE content deltas. */
function fakeServer(replies: (string | { status: number; body: string } | { models: string[] })[]): {
  fetch: FetchFn
  calls: Call[]
} {
  const calls: Call[] = []
  const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    calls.push({
      url: String(input),
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : null,
      auth: headers.get('authorization')
    })
    const reply = replies.shift()
    if (reply === undefined) throw new Error('unexpected call')
    if (typeof reply === 'object' && 'models' in reply)
      return Response.json({ object: 'list', data: reply.models.map((id) => ({ id })) })
    if (typeof reply === 'object') return new Response(reply.body, { status: reply.status })
    const events = [
      { model: 'served-model', choices: [{ delta: { content: reply.slice(0, 5) } }] },
      { choices: [{ delta: { content: reply.slice(5) }, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 12, completion_tokens: 3 } }
    ]
    const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
    return new Response(sse, { headers: { 'content-type': 'text/event-stream' } })
  }) as FetchFn
  return { fetch: fetchFn, calls }
}

const schema = z.strictObject({ answer: z.string(), page: z.number().nullable() })
const pdfText = async (): Promise<{ page: number | null; text: string; hasTextLayer: boolean }[]> => [
  { page: 5, text: 'Attenuation is measured in dB/km.', hasTextLayer: true },
  { page: 6, text: '', hasTextLayer: false }
]

const make = (fetchFn: FetchFn, baseUrl = 'http://localhost:11434/v1', apiKey: string | null = null) =>
  createOpenAiCompatibleProvider(
    { baseUrl, apiKey, models: { fast: 'qwen3.6:27b', smart: 'qwen3.6:27b' } },
    { fetch: fetchFn, pdfText, now: () => 0 }
  )

const req = {
  task: 'cards' as const,
  system: 'Write cards.',
  parts: [
    { type: 'pdf' as const, path: '/lib/chunk-0.pdf', title: 'Pages 5-6' },
    { type: 'text' as const, text: 'Go.' }
  ],
  schema,
  tier: 'smart' as const
}

describe('openai-compatible generate', () => {
  it('sends pages as text with a JSON schema and validates the reply', async () => {
    const server = fakeServer(['{"answer":"dB/km","page":5}'])
    const res = await make(server.fetch).generate(req)
    expect(res.data).toEqual({ answer: 'dB/km', page: 5 })
    expect(res.model).toBe('served-model')
    // Local runs are free.
    expect(res.usage).toMatchObject({ inputTokens: 12, outputTokens: 3, costUsd: 0 })

    const call = server.calls[0]!
    expect(call.url).toBe('http://localhost:11434/v1/chat/completions')
    expect(call.auth).toBeNull()
    expect(call.body).toMatchObject({ model: 'qwen3.6:27b', stream: true })
    expect((call.body?.['response_format'] as { type: string }).type).toBe('json_schema')
    const [system, user] = call.body?.['messages'] as { content: string }[]
    expect(system?.content).toContain('extracted text')
    expect(system?.content).toContain('"answer"')
    expect(user?.content).toContain('[SB-PAGE 5]\nAttenuation is measured in dB/km.')
    expect(user?.content).toContain('[SB-PAGE 6]\n(image-only page')
  })

  it('steps down to json_object, then plain text, and remembers what works', async () => {
    const server = fakeServer([
      { status: 400, body: '{"error":"response_format json_schema not supported"}' },
      { status: 400, body: '{"error":"response_format not supported"}' },
      '{"answer":"a","page":null}',
      '{"answer":"b","page":null}'
    ])
    const provider = make(server.fetch, 'https://api.deepseek.com/v1', 'sk-test')
    await provider.generate(req)
    const formats = server.calls.map(
      (c) => (c.body?.['response_format'] as { type: string } | undefined)?.type
    )
    expect(formats).toEqual(['json_schema', 'json_object', undefined])
    // Hosted preset: the key is sent and the output cap applies; cost is unknown, not zero.
    expect(server.calls[0]?.auth).toBe('Bearer sk-test')
    expect(server.calls[0]?.body?.['max_tokens']).toBe(8192)
    const second = await provider.generate(req)
    expect(second.usage.costUsd).toBeNull()
    expect(server.calls).toHaveLength(4)
    expect(server.calls[3]?.body?.['response_format']).toBeUndefined()
  })

  it('asks the model once to repair JSON that does not match', async () => {
    const server = fakeServer(['{"answer":"x"}', 'Fixed: {"answer":"x","page":null}'])
    const res = await make(server.fetch).generate(req)
    expect(res.data).toEqual({ answer: 'x', page: null })
    const repair = server.calls[1]?.body?.['messages'] as { role: string; content: string }[]
    expect(repair.at(-2)).toMatchObject({ role: 'assistant', content: '{"answer":"x"}' })
    expect(repair.at(-1)?.content).toContain('does not match the schema')
    expect(res.usage.outputTokens).toBe(6)
  })

  it('gives up with a retryable invalid_output after the repair fails', async () => {
    const server = fakeServer(['nope', 'still nope'])
    await expect(make(server.fetch).generate(req)).rejects.toMatchObject({
      kind: 'invalid_output',
      retryable: true
    })
  })

  it('does not retry other client errors', async () => {
    const server = fakeServer([
      { status: 404, body: '{"error":"model \\"qwen3.6:27b\\" not found, try pulling it first"}' }
    ])
    await expect(make(server.fetch).generate(req)).rejects.toMatchObject({
      kind: 'unavailable',
      message: expect.stringContaining('ollama pull qwen3.6:27b')
    })
    expect(server.calls).toHaveLength(1)
  })
})

describe('openai-compatible stream', () => {
  it('streams visible text and finishes with usage', async () => {
    const server = fakeServer(['<think>x</think>Hello there'])
    const events = []
    for await (const e of make(server.fetch).stream({ ...req, task: 'chat' })) events.push(e)
    const text = events.map((e) => (e.type === 'text' ? e.text : '')).join('')
    expect(text).toBe('Hello there')
    expect(events.at(-1)).toMatchObject({ type: 'done', model: 'served-model' })
    expect(server.calls[0]?.body?.['response_format']).toBeUndefined()
  })
})

describe('health and models', () => {
  it('lists models sorted', async () => {
    const server = fakeServer([{ models: ['b', 'a'] }])
    expect(
      await listModels({ baseUrl: 'http://localhost:1234/v1/', apiKey: null }, { fetch: server.fetch })
    ).toEqual(['a', 'b'])
    expect(server.calls[0]?.url).toBe('http://localhost:1234/v1/models')
  })

  it('names the missing model and how to install it', async () => {
    const server = fakeServer([{ models: ['llama3:8b'] }])
    const h = await make(server.fetch).health()
    expect(h.ok).toBe(false)
    expect(h.message).toContain('ollama pull qwen3.6:27b')
    expect(h.message).toContain('llama3:8b')
  })

  it('passes when the model is there and answers', async () => {
    const server = fakeServer([{ models: ['qwen3.6:27b'] }, '{"ok":true}'])
    expect(await make(server.fetch).health()).toMatchObject({ ok: true, provider: 'openai-compatible' })
  })

  it('treats an untagged Ollama name as :latest', () => {
    expect(sameModel('qwen3.6:latest', 'qwen3.6')).toBe(true)
    expect(sameModel('qwen3.6:27b', 'qwen3.6')).toBe(false)
  })
})
