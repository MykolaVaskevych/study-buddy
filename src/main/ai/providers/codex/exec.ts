import { AiError, type Effort, type Usage } from '@shared/ai/provider'

/**
 * `codex exec` as a plain model call: the pieces that need no process (command line, event
 * parsing, error mapping), unit-tested on their own.
 */

/** Said before every prompt: Codex is an agent, the app wants an answer, not actions. */
export const PLAIN_MODEL_NOTE =
  'You are used as a plain language model inside a study app. Do not run commands, read files or use tools: answer directly from the input below.'

export function codexArgs(opts: {
  model: string
  effort: Effort
  /** JSON Schema file for structured output; null for free text. */
  schemaPath: string | null
  outPath: string
}): string[] {
  return [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--ephemeral',
    // The user's config may add MCP servers, hooks and a high default effort; the app sets its own.
    '--ignore-user-config',
    '--ignore-rules',
    '--sandbox',
    'read-only',
    '-m',
    opts.model,
    '-c',
    `model_reasoning_effort="${opts.effort}"`,
    ...(opts.schemaPath ? ['--output-schema', opts.schemaPath] : []),
    '-o',
    opts.outPath,
    // The prompt comes on stdin.
    '-'
  ]
}

export interface CodexRun {
  usage: Usage
  /** The last error Codex reported, if the turn failed. */
  error: string | null
}

const ZERO: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: null,
  notional: true
}

/** Reads the JSONL events of `codex exec --json`: token usage and the failure, if any. */
export function parseEvents(jsonl: string): CodexRun {
  let usage = ZERO
  let error: string | null = null
  for (const line of jsonl.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let event: Record<string, unknown>
    try {
      event = JSON.parse(line) as Record<string, unknown>
    } catch {
      continue
    }
    const type = event['type']
    if (type === 'turn.completed') {
      const u = (event['usage'] ?? {}) as Record<string, unknown>
      const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
      usage = {
        inputTokens: num(u['input_tokens']),
        outputTokens: num(u['output_tokens']),
        cacheReadTokens: num(u['cached_input_tokens']),
        cacheWriteTokens: 0,
        costUsd: null,
        notional: true
      }
    } else if (type === 'turn.failed') {
      const e = (event['error'] ?? {}) as Record<string, unknown>
      error = typeof e['message'] === 'string' ? e['message'] : 'Codex failed'
    } else if (
      type === 'error' &&
      typeof event['message'] === 'string' &&
      !/^Reconnecting/.test(event['message'])
    ) {
      error = event['message']
    }
  }
  return { usage, error }
}

/** Maps what Codex printed when it failed to an AiError the app can explain. */
export function codexError(message: string, stderr = ''): AiError {
  const text = `${message}\n${stderr}`
  if (/refresh|sign in again|log ?in again|unauthori[sz]ed|401|not logged in/i.test(text))
    return new AiError(
      'auth',
      'Codex is not signed in (or the sign-in expired). Sign in again in Settings.',
      {
        retryable: false
      }
    )
  if (/usage limit|rate limit|too many requests|429/i.test(text)) {
    const at = /try again (?:at|after) ([^.\n]+)/i.exec(text)?.[1]
    const resetAt = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : null
    return new AiError('rate_limited', 'Codex hit your ChatGPT plan’s usage limit.', { resetAt })
  }
  if (/model .*(not found|does not exist|not supported)|unknown model/i.test(text))
    return new AiError('unavailable', `Codex cannot use this model: ${message}`, { retryable: false })
  return new AiError('unavailable', `Codex failed: ${message.slice(0, 300)}`)
}
