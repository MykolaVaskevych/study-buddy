import { AiError } from '@shared/ai/provider'

/**
 * Pure pieces of the OpenAI-compatible provider: page text formatting, the SSE stream reader,
 * stripping reasoning text, pulling JSON out of chatty replies and mapping HTTP failures. Servers
 * differ in small ways (Ollama, LM Studio, llama.cpp, DeepSeek, OpenRouter), so everything here is
 * lenient about shape and strict about what it returns.
 */

/** One page of a PDF part as text; mirrors the library's ChunkPageText. */
export interface PageText {
  page: number | null
  text: string
  hasTextLayer: boolean
}

/** What the model is told about receiving pages as text, appended to the system prompt. */
export const TEXT_ONLY_NOTE = [
  'Documents reach you as extracted text, not as images.',
  'Each page starts with a line such as "[SB-PAGE 12]" giving its absolute page number: use those numbers',
  'wherever page numbers are asked for. A page marked "image-only" has no text you can read: never invent',
  'its content; leave it out or say it is a figure or slide you cannot see.'
].join(' ')

/**
 * A PDF part as text. Pages without a stamp are numbered from the first stamped page, so a chunk
 * whose image-only pages lost their stamp in extraction still gets absolute numbers.
 */
export function documentText(pages: readonly PageText[], title: string | null): string {
  const anchor = pages.findIndex((p) => p.page !== null)
  const start = anchor === -1 ? null : (pages[anchor]?.page ?? 0) - anchor
  const body = pages.map((p, i) => {
    const label = p.page ?? (start === null ? null : start + i)
    const head = label === null ? `[page ${i + 1} of this document]` : `[SB-PAGE ${label}]`
    return p.hasTextLayer ? `${head}\n${p.text}` : `${head}\n(image-only page: no text layer)`
  })
  return [`<document${title === null ? '' : ` title="${title}"`}>`, ...body, '</document>'].join('\n\n')
}

/** Data payloads of a server-sent event stream; stops at "[DONE]". */
export async function* sseData(body: AsyncIterable<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const lines = buffer.split(/\r?\n/)
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data:')) continue
      const data = line.slice(5).trim()
      if (data === '[DONE]') return
      if (data !== '') yield data
    }
  }
  const last = buffer.trim()
  if (last.startsWith('data:') && last.slice(5).trim() !== '[DONE]') yield last.slice(5).trim()
}

const OPEN = '<think>'
const CLOSE = '</think>'

/**
 * Hides <think>...</think> blocks from streamed text. Most servers send reasoning in a separate
 * field, but some (LM Studio, plain llama.cpp builds) leave it inline. Tags may be split across
 * deltas, so a possible partial tag is held back until the next delta decides it.
 */
export function createThinkFilter(): { push(text: string): string; flush(): string } {
  let buffer = ''
  let thinking = false
  const heldBack = (s: string, tag: string): number => {
    for (let n = Math.min(tag.length - 1, s.length); n > 0; n--) if (tag.startsWith(s.slice(-n))) return n
    return 0
  }
  return {
    push(text) {
      buffer += text
      let out = ''
      for (;;) {
        if (!thinking) {
          const at = buffer.indexOf(OPEN)
          if (at === -1) {
            const keep = heldBack(buffer, OPEN)
            out += buffer.slice(0, buffer.length - keep)
            buffer = buffer.slice(buffer.length - keep)
            return out
          }
          out += buffer.slice(0, at)
          buffer = buffer.slice(at + OPEN.length)
          thinking = true
        } else {
          const at = buffer.indexOf(CLOSE)
          if (at === -1) {
            buffer = buffer.slice(buffer.length - heldBack(buffer, CLOSE))
            return out
          }
          buffer = buffer.slice(at + CLOSE.length)
          thinking = false
        }
      }
    },
    flush() {
      const out = thinking ? '' : buffer
      buffer = ''
      return out
    }
  }
}

/** The text with reasoning blocks removed (also an unclosed one at the end). */
export function stripThinking(text: string): string {
  const filter = createThinkFilter()
  return (filter.push(text) + filter.flush()).trim()
}

/**
 * Parses the JSON object in a reply. Small models wrap it in prose or code fences even in JSON
 * mode, so fall back to the outermost braces. Throws a retryable invalid_output.
 */
export function extractJson(reply: string): unknown {
  const text = stripThinking(reply)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
  try {
    return JSON.parse(text)
  } catch {
    const from = text.indexOf('{')
    const to = text.lastIndexOf('}')
    if (from !== -1 && to > from) {
      try {
        return JSON.parse(text.slice(from, to + 1))
      } catch {
        // Fall through to the error below.
      }
    }
    throw new AiError('invalid_output', 'The model did not return valid JSON')
  }
}

/** Server error text from the usual shapes: {error:{message}}, {error:"..."}, {message}, or raw text. */
export function errorText(body: string): string {
  try {
    const json: unknown = JSON.parse(body)
    if (typeof json === 'object' && json !== null) {
      const { error, message } = json as { error?: unknown; message?: unknown }
      if (typeof error === 'string') return error
      if (typeof error === 'object' && error !== null) {
        const inner = (error as { message?: unknown }).message
        if (typeof inner === 'string') return inner
      }
      if (typeof message === 'string') return message
    }
  } catch {
    // Not JSON: use the raw text.
  }
  return body.trim().slice(0, 300) || 'no details'
}

export interface HttpContext {
  /** e.g. "Ollama" or "the server". */
  server: string
  model: string
  /** Shell command that installs a missing model, when the server has one (ollama pull). */
  pullHint: string | null
  now: number
}

/**
 * Maps a non-2xx response. 400/422 are 'unknown' and not retryable: the request itself is wrong
 * (the provider decides separately whether to retry without response_format).
 */
export function httpError(
  status: number,
  body: string,
  retryAfter: string | null,
  ctx: HttpContext
): AiError {
  const detail = errorText(body)
  if (status === 401 || status === 403)
    return new AiError('auth', `${ctx.server} rejected the API key (${status}): ${detail}`)
  if (status === 429) {
    const seconds = Number(retryAfter)
    const resetAt =
      Number.isFinite(seconds) && seconds > 0 ? new Date(ctx.now + seconds * 1000).toISOString() : null
    return new AiError('rate_limited', `${ctx.server} is rate limiting requests: ${detail}`, { resetAt })
  }
  if (status === 404 || /model .*not found|no such model|model_not_found/i.test(detail)) {
    if (/model/i.test(detail)) {
      const pull = ctx.pullHint === null ? '' : ` Install it with: ${ctx.pullHint}`
      return new AiError('unavailable', `Model "${ctx.model}" is not available on ${ctx.server}.${pull}`, {
        retryable: false
      })
    }
    return new AiError(
      'unavailable',
      `${ctx.server} has no such endpoint (404). Check that the URL ends in /v1.`,
      {
        retryable: false
      }
    )
  }
  if (/context (length|window)|too many tokens|maximum context|exceeds the context/i.test(detail))
    return new AiError(
      'truncated',
      `The pages do not fit the model's context window. Raise the server's context length (32k or more): ${detail}`,
      { retryable: false }
    )
  if (status >= 500) return new AiError('unavailable', `${ctx.server} failed (${status}): ${detail}`)
  return new AiError('unknown', `${ctx.server} refused the request (${status}): ${detail}`, {
    retryable: false
  })
}

/** Maps a fetch that never got a response (server down, DNS, TLS, abort). */
export function fetchError(err: unknown, server: string, baseUrl: string, local: boolean): AiError {
  if (err instanceof AiError) return err
  if (err instanceof Error && err.name === 'AbortError') return new AiError('cancelled', 'Request cancelled')
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : null
  const code =
    (cause as (Error & { code?: string }) | null)?.code ?? (err instanceof Error ? err.message : String(err))
  const hint = local ? ` Is ${server} running?` : ''
  return new AiError('network', `Cannot reach ${server} at ${baseUrl} (${code}).${hint}`, { cause: err })
}
