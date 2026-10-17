import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  AuthenticationError,
  BadRequestError,
  InternalServerError,
  NotFoundError,
  PermissionDeniedError,
  RateLimitError
} from '@anthropic-ai/sdk'
import { AiError } from '@shared/ai/provider'
import { mapApiError, resetAtFromHeaders } from './errors'

const NOW = Date.UTC(2026, 9, 17, 10, 0)
const body = (type: string) => ({ type: 'error', error: { type, message: type } })

describe('mapApiError', () => {
  it('maps RateLimitError with retry-after seconds', () => {
    const err = mapApiError(
      new RateLimitError(429, body('rate_limit_error'), 'rate limited', new Headers({ 'retry-after': '30' })),
      NOW
    )
    expect(err).toMatchObject({ kind: 'rate_limited', resetAt: '2026-10-17T10:00:30.000Z' })
  })

  it('maps auth and permission errors to non-retryable auth', () => {
    for (const e of [
      new AuthenticationError(401, body('authentication_error'), 'bad key', new Headers()),
      new PermissionDeniedError(403, body('permission_error'), 'no', new Headers())
    ])
      expect(mapApiError(e, NOW)).toMatchObject({ kind: 'auth', retryable: false })
  })

  it('maps connection problems to retryable network', () => {
    expect(mapApiError(new APIConnectionError({ message: 'ECONNRESET' }), NOW)).toMatchObject({
      kind: 'network',
      retryable: true
    })
    expect(mapApiError(new APIConnectionTimeoutError(), NOW).kind).toBe('network')
  })

  it('maps aborts to cancelled before anything else', () => {
    expect(mapApiError(new APIUserAbortError(), NOW).kind).toBe('cancelled')
  })

  it('maps 5xx and overloaded errors to retryable unavailable', () => {
    expect(
      mapApiError(new InternalServerError(500, body('api_error'), 'oops', new Headers()), NOW)
    ).toMatchObject({
      kind: 'unavailable',
      retryable: true
    })
    expect(
      mapApiError(new InternalServerError(529, body('overloaded_error'), 'busy', new Headers()), NOW).kind
    ).toBe('unavailable')
    // Mid-stream SSE error: no status, only the error type.
    const midStream = new APIError(
      undefined,
      body('overloaded_error'),
      'Overloaded',
      undefined,
      'overloaded_error'
    )
    expect(mapApiError(midStream, NOW)).toMatchObject({ kind: 'unavailable', retryable: true })
  })

  it('maps a missing model to non-retryable unavailable and bad requests to unknown', () => {
    expect(
      mapApiError(new NotFoundError(404, body('not_found_error'), 'model', new Headers()), NOW)
    ).toMatchObject({
      kind: 'unavailable',
      retryable: false
    })
    expect(
      mapApiError(new BadRequestError(400, body('invalid_request_error'), 'bad', new Headers()), NOW)
    ).toMatchObject({
      kind: 'unknown',
      retryable: false
    })
  })

  it('passes AiError through and wraps anything else', () => {
    const ai = new AiError('truncated', 'cut')
    expect(mapApiError(ai, NOW)).toBe(ai)
    expect(mapApiError(new Error('x'), NOW)).toMatchObject({ kind: 'unknown', message: 'x' })
  })
})

describe('resetAtFromHeaders', () => {
  it('reads seconds or an HTTP date', () => {
    expect(resetAtFromHeaders(new Headers({ 'retry-after': '2.5' }), NOW)).toBe('2026-10-17T10:00:02.500Z')
    expect(resetAtFromHeaders(new Headers({ 'retry-after': 'Sat, 17 Oct 2026 11:00:00 GMT' }), NOW)).toBe(
      '2026-10-17T11:00:00.000Z'
    )
    expect(resetAtFromHeaders(new Headers(), NOW)).toBeNull()
    expect(resetAtFromHeaders(undefined, NOW)).toBeNull()
  })
})
