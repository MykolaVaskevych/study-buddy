import {
  AbortError,
  type SDKAssistantMessageError,
  type SDKMessage,
  type SDKRateLimitInfo,
  type SDKResultMessage
} from '@anthropic-ai/claude-agent-sdk'
import { AiError, type AiErrorKind } from '@shared/ai/provider'
import { parseResetAt, resetAtFromUnix } from './reset-time'

/**
 * Maps what the Claude Code runtime reports into AiError. Failures surface in three places:
 *  1. stream messages before the result: `rate_limit_event` (structured reset time), an assistant
 *     message carrying `error` (authentication_failed, rate_limit, ...) and refusal notices;
 *  2. the result message: error subtypes, or `success` with `is_error: true` on API errors;
 *  3. exceptions from the iterator: spawn failures, process exits, aborts.
 * `RunState` collects (1) so that (2) and (3) can be classified with the most specific signal.
 */

export interface RunState {
  /** Latest rate-limit info for the subscription (status, reset time, limit type). */
  rateLimit: SDKRateLimitInfo | null
  /** Error carried by the last assistant message, with its text. */
  assistantError: { kind: SDKAssistantMessageError; text: string } | null
  /** Text of a refusal notice, if the model refused and no fallback ran. */
  refusal: string | null
  /** Tail of the runtime's stderr, for diagnostics in error messages. */
  stderr: string
}

export function newRunState(): RunState {
  return { rateLimit: null, assistantError: null, refusal: null, stderr: '' }
}

const STDERR_TAIL = 2000

export function appendStderr(state: RunState, chunk: string): void {
  state.stderr = (state.stderr + chunk).slice(-STDERR_TAIL)
}

function assistantText(msg: Extract<SDKMessage, { type: 'assistant' }>): string {
  return msg.message.content
    .map((block) => (block.type === 'text' ? block.text : ''))
    .join('')
    .trim()
}

/** Records the failure signals of one stream message into the run state. */
export function observeMessage(state: RunState, msg: SDKMessage): void {
  if (msg.type === 'rate_limit_event') state.rateLimit = msg.rate_limit_info
  else if (msg.type === 'assistant' && msg.error !== undefined && msg.parent_tool_use_id === null)
    state.assistantError = { kind: msg.error, text: assistantText(msg) }
  else if (msg.type === 'system' && msg.subtype === 'model_refusal_no_fallback') state.refusal = msg.content
}

const AUTH_ERRORS: ReadonlySet<SDKAssistantMessageError> = new Set([
  'authentication_failed',
  'oauth_org_not_allowed',
  'account_on_hold',
  'verification_required',
  'billing_error',
  'cloud_credential_error'
])

/** Best-effort classification of free text from the CLI (result text, error list, stderr). */
export function classifyText(text: string): AiErrorKind | null {
  if (
    /not logged in|run \/login|invalid api key|authenticat|oauth (token|session)|unauthori[sz]ed|api error:?\s*40[13]\b/i.test(
      text
    )
  )
    return 'auth'
  if (
    /hit your .{0,40}limit|usage limit|rate[ _-]?limit|limit reached|too many requests|api error:?\s*429\b/i.test(
      text
    )
  )
    return 'rate_limited'
  if (/overloaded|high load|internal server error|service unavailable|api error:?\s*5\d\d\b/i.test(text))
    return 'unavailable'
  return null
}

/** Reset time: the structured rate-limit event first, then whatever the message text says. */
export function resetAtFor(state: RunState, text: string, now: number): string | null {
  const info = state.rateLimit
  const structured =
    info !== null && info.status === 'rejected'
      ? resetAtFromUnix(info.isUsingOverage === true ? info.overageResetsAt : info.resetsAt)
      : null
  return structured ?? parseResetAt(text, now) ?? resetAtFromUnix(info?.resetsAt)
}

/** `parseText` may carry more context (e.g. stderr) than the message shown to the user. */
function rateLimited(state: RunState, text: string, now: number, parseText = text): AiError {
  const message = text.trim() === '' ? 'Claude usage limit reached' : text.trim()
  return new AiError('rate_limited', message, { resetAt: resetAtFor(state, parseText, now) })
}

function fromKind(kind: AiErrorKind, text: string, state: RunState, now: number): AiError {
  return kind === 'rate_limited' ? rateLimited(state, text, now) : new AiError(kind, text)
}

/** Maps the `error` field of an assistant message. */
export function errorFromAssistant(
  kind: SDKAssistantMessageError,
  text: string,
  state: RunState,
  now: number
): AiError {
  const message = text.trim() === '' ? `Claude Code reported ${kind}` : text.trim()
  if (AUTH_ERRORS.has(kind)) return new AiError('auth', message)
  switch (kind) {
    case 'rate_limit':
      return rateLimited(state, message, now)
    case 'overloaded':
    case 'server_error':
      return new AiError('unavailable', message)
    case 'max_output_tokens':
      return new AiError('truncated', message)
    case 'model_not_found':
      return new AiError('unavailable', message, { retryable: false })
    case 'invalid_request':
      return new AiError('unknown', message, { retryable: false })
    default:
      return fromKind(classifyText(message) ?? 'unknown', message, state, now)
  }
}

/** A turn that ended in an error: use the most specific signal available. */
function failedTurn(text: string, status: number | null, state: RunState, now: number): AiError {
  if (state.refusal !== null) return new AiError('refused', state.refusal)
  if (state.assistantError !== null)
    return errorFromAssistant(state.assistantError.kind, state.assistantError.text || text, state, now)
  if (status === 401 || status === 403) return new AiError('auth', text)
  if (status === 429) return rateLimited(state, text, now)
  if (status !== null && status >= 500) return new AiError('unavailable', text)
  if (state.rateLimit?.status === 'rejected') return rateLimited(state, text, now)
  const kind = classifyText(text)
  return kind === null
    ? new AiError('unknown', text || 'Claude Code request failed')
    : fromKind(kind, text, state, now)
}

/** Null when the result is a usable success; otherwise the AiError describing the failure. */
export function errorFromResult(result: SDKResultMessage, state: RunState, now: number): AiError | null {
  if (result.subtype === 'success') {
    if (result.stop_reason === 'refusal' || state.refusal !== null)
      return new AiError('refused', state.refusal ?? (result.result || 'The model declined this request'))
    if (!result.is_error) return null
    return failedTurn(result.result, result.api_error_status ?? null, state, now)
  }
  switch (result.subtype) {
    case 'error_max_turns':
      return new AiError(
        'invalid_output',
        'Claude Code reached the turn limit before returning the structured output'
      )
    case 'error_max_structured_output_retries':
      return new AiError('invalid_output', 'Claude Code could not produce output matching the schema')
    case 'error_max_budget_usd':
      return new AiError('unknown', 'Claude Code stopped at its budget limit', { retryable: false })
    case 'error_during_execution': {
      const text = [...result.errors, result.terminal_reason ?? ''].filter((s) => s !== '').join('; ')
      return failedTurn(text, null, state, now)
    }
  }
}

/** Maps an exception thrown while iterating the query. */
export function errorFromThrown(
  err: unknown,
  state: RunState,
  ctx: { aborted: boolean; timedOutAfterMs: number | null },
  now: number
): AiError {
  if (err instanceof AiError) return err
  if (ctx.timedOutAfterMs !== null)
    return new AiError(
      'unavailable',
      `Claude Code did not finish within ${Math.round(ctx.timedOutAfterMs / 1000)} s`,
      {
        cause: err
      }
    )
  if (ctx.aborted || err instanceof AbortError || (err instanceof Error && err.name === 'AbortError'))
    return new AiError('cancelled', 'Request cancelled', { cause: err })

  const message = err instanceof Error ? err.message : String(err)
  if (/not found at|executable not found|exists but failed to launch/i.test(message))
    return new AiError('unavailable', `Claude Code is not available: ${message}`, {
      retryable: false,
      cause: err
    })
  // Argument validation by the CLI (e.g. a rejected --json-schema): retrying cannot help.
  if (/is not a valid JSON Schema|error: (unknown|invalid) option/i.test(`${message}\n${state.stderr}`))
    return new AiError('unknown', `Claude Code rejected the request: ${message}`, {
      retryable: false,
      cause: err
    })
  if (/failed to spawn/i.test(message))
    return new AiError('unavailable', `Could not start Claude Code: ${message}`, { cause: err })
  if (state.assistantError !== null) {
    const mapped = errorFromAssistant(state.assistantError.kind, state.assistantError.text, state, now)
    return new AiError(mapped.kind, mapped.message, {
      retryable: mapped.retryable,
      resetAt: mapped.resetAt,
      cause: err
    })
  }
  const context = `${message}\n${state.stderr}`
  const kind = classifyText(context)
  if (kind === 'rate_limited') return rateLimited(state, message, now, context)
  if (kind !== null) return new AiError(kind, message, { cause: err })
  if (/exited with code|terminated by signal/i.test(message))
    return new AiError('unavailable', `Claude Code stopped unexpectedly: ${message}`, { cause: err })
  return new AiError('unknown', message, { cause: err })
}
