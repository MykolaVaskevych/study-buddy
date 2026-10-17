import {
  APIConnectionError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError
} from '@anthropic-ai/sdk'
import { AiError } from '@shared/ai/provider'

/**
 * Maps typed `@anthropic-ai/sdk` errors to AiError. Order matters: the abort and connection
 * errors are subclasses of APIError in the TypeScript SDK, so they are checked first. Errors that
 * arrive mid-stream as SSE `error` events have no HTTP status, only the API error `type`.
 * Messages never include request headers or the key.
 */

/** Reset time from `retry-after` (seconds or an HTTP date). */
export function resetAtFromHeaders(headers: Headers | undefined, now: number): string | null {
  const value = headers?.get('retry-after')?.trim()
  if (!value) return null
  if (/^\d+(\.\d+)?$/.test(value)) return new Date(now + Number(value) * 1000).toISOString()
  const date = Date.parse(value)
  return Number.isNaN(date) ? null : new Date(date).toISOString()
}

export function mapApiError(err: unknown, now: number): AiError {
  if (err instanceof AiError) return err
  if (err instanceof APIUserAbortError) return new AiError('cancelled', 'Request cancelled', { cause: err })
  if (err instanceof APIConnectionError)
    return new AiError('network', `Cannot reach the Anthropic API: ${err.message}`, { cause: err })
  if (err instanceof RateLimitError)
    return new AiError('rate_limited', 'Anthropic API rate limit reached', {
      resetAt: resetAtFromHeaders(err.headers, now),
      cause: err
    })
  if (err instanceof AuthenticationError || err instanceof PermissionDeniedError)
    return new AiError('auth', 'The Anthropic API key was rejected', { cause: err })
  if (err instanceof NotFoundError)
    return new AiError('unavailable', `Model or endpoint not found: ${err.message}`, {
      retryable: false,
      cause: err
    })
  if (err instanceof InternalServerError)
    return new AiError('unavailable', `Anthropic API unavailable (${err.status})`, { cause: err })
  if (err instanceof APIError) {
    // Mid-stream error events carry only the type, e.g. overloaded_error.
    switch (err.type) {
      case 'overloaded_error':
      case 'api_error':
      case 'timeout_error':
        return new AiError('unavailable', `Anthropic API unavailable (${err.type})`, { cause: err })
      case 'rate_limit_error':
        return new AiError('rate_limited', 'Anthropic API rate limit reached', { cause: err })
      case 'authentication_error':
      case 'permission_error':
      case 'billing_error':
        return new AiError('auth', `Anthropic API account problem (${err.type})`, { cause: err })
      default:
        if (err.status !== undefined && err.status >= 500)
          return new AiError('unavailable', `Anthropic API unavailable (${err.status})`, { cause: err })
        return new AiError('unknown', `Anthropic API error: ${err.message}`, { retryable: false, cause: err })
    }
  }
  if (err instanceof Error && err.name === 'AbortError')
    return new AiError('cancelled', 'Request cancelled', { cause: err })
  return new AiError('unknown', err instanceof Error ? err.message : String(err), { cause: err })
}
