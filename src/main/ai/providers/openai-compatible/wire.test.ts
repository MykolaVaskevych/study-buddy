import { AiError } from '@shared/ai/provider'
import {
  createThinkFilter,
  documentText,
  errorText,
  extractJson,
  fetchError,
  httpError,
  sseData,
  stripThinking
} from './wire'

const bytes = (...parts: string[]): AsyncIterable<Uint8Array> =>
  (async function* () {
    for (const p of parts) yield new TextEncoder().encode(p)
  })()

const collect = async (it: AsyncIterable<string>): Promise<string[]> => {
  const out: string[] = []
  for await (const x of it) out.push(x)
  return out
}

describe('documentText', () => {
  it('labels pages with their stamps and flags image-only pages', () => {
    const text = documentText(
      [
        { page: 11, text: 'Snell law', hasTextLayer: true },
        { page: null, text: '', hasTextLayer: false },
        { page: 13, text: 'Fibre modes', hasTextLayer: true }
      ],
      'Pages 11-13'
    )
    expect(text).toContain('<document title="Pages 11-13">')
    expect(text).toContain('[SB-PAGE 11]\nSnell law')
    // The unstamped page is numbered from its neighbours.
    expect(text).toContain('[SB-PAGE 12]\n(image-only page: no text layer)')
    expect(text).toContain('[SB-PAGE 13]\nFibre modes')
  })

  it('falls back to positions when no page has a stamp', () => {
    expect(documentText([{ page: null, text: 'x', hasTextLayer: true }], null)).toContain(
      '[page 1 of this document]'
    )
  })
})

describe('sseData', () => {
  it('joins events split across chunks and stops at [DONE]', async () => {
    const out = await collect(
      sseData(
        bytes('data: {"a":', '1}\n\ndata: {"b":2}\r\n', ': ping\n', 'data: [DONE]\n', 'data: {"c":3}\n')
      )
    )
    expect(out).toEqual(['{"a":1}', '{"b":2}'])
  })

  it('yields a last event without a trailing newline', async () => {
    expect(await collect(sseData(bytes('data: {"a":1}')))).toEqual(['{"a":1}'])
  })
})

describe('think filter', () => {
  it('hides reasoning even when the tags are split across deltas', () => {
    const f = createThinkFilter()
    const out =
      ['Hel', 'lo <th', 'ink>secret', ' plan</thi', 'nk> world'].map((d) => f.push(d)).join('') + f.flush()
    expect(out).toBe('Hello  world')
  })

  it('keeps a "<" that is not a tag and drops an unclosed block', () => {
    expect(stripThinking('a < b')).toBe('a < b')
    expect(stripThinking('{"x":1}<think>still going')).toBe('{"x":1}')
  })
})

describe('extractJson', () => {
  it('reads plain, fenced and chatty replies', () => {
    expect(extractJson('{"ok":true}')).toEqual({ ok: true })
    expect(extractJson('```json\n{"ok":true}\n```')).toEqual({ ok: true })
    expect(extractJson('<think>hmm</think>Sure! Here it is: {"ok":true} Hope that helps.')).toEqual({
      ok: true
    })
  })

  it('throws a retryable invalid_output for no JSON', () => {
    const err = (() => {
      try {
        extractJson('no json here')
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(AiError)
    expect(err).toMatchObject({ kind: 'invalid_output', retryable: true })
  })
})

describe('errors', () => {
  const ctx = { server: 'Ollama', model: 'qwen3.6:27b', pullHint: 'ollama pull qwen3.6:27b', now: 0 }

  it('reads the common error shapes', () => {
    expect(errorText('{"error":{"message":"bad"}}')).toBe('bad')
    expect(errorText('{"error":"bad"}')).toBe('bad')
    expect(errorText('{"message":"bad"}')).toBe('bad')
    expect(errorText('  plain  ')).toBe('plain')
  })

  it('maps statuses to kinds with actionable messages', () => {
    expect(httpError(401, '{"error":"no"}', null, ctx).kind).toBe('auth')
    const limited = httpError(429, '', '30', ctx)
    expect(limited).toMatchObject({ kind: 'rate_limited', resetAt: '1970-01-01T00:00:30.000Z' })
    const missing = httpError(404, '{"error":{"message":"model \\"qwen3.6:27b\\" not found"}}', null, ctx)
    expect(missing).toMatchObject({ kind: 'unavailable', retryable: false })
    expect(missing.message).toContain('ollama pull qwen3.6:27b')
    expect(httpError(404, 'page not found', null, ctx).message).toContain('/v1')
    expect(httpError(400, '{"error":"exceeds the context window"}', null, ctx).kind).toBe('truncated')
    expect(httpError(503, 'loading', null, ctx)).toMatchObject({ kind: 'unavailable', retryable: true })
    expect(httpError(400, 'bad param', null, ctx)).toMatchObject({ kind: 'unknown', retryable: false })
  })

  it('explains a server that is not running', () => {
    const refused = new TypeError('fetch failed', {
      cause: Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })
    })
    const err = fetchError(refused, 'Ollama', 'http://localhost:11434/v1', true)
    expect(err).toMatchObject({ kind: 'network', retryable: true })
    expect(err.message).toContain('ECONNREFUSED')
    expect(err.message).toContain('Is Ollama running?')
    expect(fetchError(Object.assign(new Error('x'), { name: 'AbortError' }), 's', 'u', false).kind).toBe(
      'cancelled'
    )
  })
})
