import { AbortError, type SDKMessage, type SDKResultMessage } from '@anthropic-ai/claude-agent-sdk'
import { AiError } from '@shared/ai/provider'
import {
  classifyText,
  errorFromResult,
  errorFromThrown,
  newRunState,
  observeMessage,
  type RunState
} from './errors'
import { assistantText, errorResult, rateLimitEvent, refusalNotice, successResult } from './test-messages'

const NOW = Date.UTC(2026, 9, 17, 10, 0)

function replay(messages: SDKMessage[], result: SDKResultMessage): AiError | null {
  const state = newRunState()
  for (const m of messages) observeMessage(state, m)
  return errorFromResult(result, state, NOW)
}

describe('errorFromResult', () => {
  it('returns null for a usable success', () => {
    expect(replay([assistantText('{}')], successResult())).toBeNull()
  })

  it('maps "not logged in" to auth', () => {
    const err = replay(
      [assistantText('Not logged in · Please run /login', 'authentication_failed')],
      successResult({ is_error: true, result: 'Not logged in · Please run /login' })
    )
    expect(err).toMatchObject({
      kind: 'auth',
      retryable: false,
      message: 'Not logged in · Please run /login'
    })
  })

  it.each(['oauth_org_not_allowed', 'account_on_hold', 'billing_error', 'verification_required'] as const)(
    'maps %s to auth',
    (kind) => {
      expect(replay([assistantText('x', kind)], successResult({ is_error: true, result: 'x' }))?.kind).toBe(
        'auth'
      )
    }
  )

  it('maps a subscription limit to rate_limited with the structured reset time', () => {
    const err = replay(
      [
        rateLimitEvent({ status: 'rejected', resetsAt: 1792252800, rateLimitType: 'five_hour' }),
        assistantText("You've hit your session limit · resets 3pm (Europe/Kyiv)", 'rate_limit')
      ],
      successResult({ is_error: true, result: "You've hit your session limit · resets 3pm (Europe/Kyiv)" })
    )
    expect(err).toMatchObject({ kind: 'rate_limited', resetAt: new Date(1792252800 * 1000).toISOString() })
    expect(err?.message).toContain('session limit')
  })

  it('uses the overage reset time when the overage budget was the blocker', () => {
    const err = replay(
      [
        rateLimitEvent({
          status: 'rejected',
          resetsAt: 1,
          isUsingOverage: true,
          overageResetsAt: 1792252800
        }),
        assistantText("You've hit your usage credit limit", 'rate_limit')
      ],
      successResult({ is_error: true })
    )
    expect(err?.resetAt).toBe(new Date(1792252800 * 1000).toISOString())
  })

  it('parses the reset time from the message when no event was seen', () => {
    const err = replay(
      [assistantText("You've hit your session limit · resets 3pm (Europe/Kyiv)", 'rate_limit')],
      successResult({ is_error: true })
    )
    expect(err).toMatchObject({ kind: 'rate_limited', resetAt: '2026-10-17T12:00:00.000Z' })
  })

  it('recognises the legacy limit text in the result alone', () => {
    const err = replay(
      [],
      successResult({ is_error: true, result: 'Claude AI usage limit reached|1792252800' })
    )
    expect(err).toMatchObject({ kind: 'rate_limited', resetAt: new Date(1792252800 * 1000).toISOString() })
  })

  it('maps HTTP status codes when there is no assistant error', () => {
    expect(
      replay([], successResult({ is_error: true, result: 'API Error', api_error_status: 401 }))?.kind
    ).toBe('auth')
    expect(
      replay([], successResult({ is_error: true, result: 'API Error', api_error_status: 429 }))?.kind
    ).toBe('rate_limited')
    const overloaded = replay(
      [],
      successResult({ is_error: true, result: 'Overloaded', api_error_status: 529 })
    )
    expect(overloaded).toMatchObject({ kind: 'unavailable', retryable: true })
  })

  it('maps other assistant errors', () => {
    const run = (kind: Parameters<typeof assistantText>[1]): AiError | null =>
      replay([assistantText('boom', kind)], successResult({ is_error: true }))
    expect(run('overloaded')).toMatchObject({ kind: 'unavailable', retryable: true })
    expect(run('server_error')).toMatchObject({ kind: 'unavailable', retryable: true })
    expect(run('max_output_tokens')?.kind).toBe('truncated')
    expect(run('model_not_found')).toMatchObject({ kind: 'unavailable', retryable: false })
    expect(run('invalid_request')).toMatchObject({ kind: 'unknown', retryable: false })
  })

  it('maps refusals', () => {
    expect(replay([refusalNotice('Declined: cyber')], successResult())?.kind).toBe('refused')
    expect(
      replay([], successResult({ stop_reason: 'refusal', result: 'I can’t help with that' }))
    ).toMatchObject({
      kind: 'refused',
      retryable: false
    })
  })

  it('maps turn and structured-output exhaustion to retryable invalid_output', () => {
    for (const subtype of ['error_max_turns', 'error_max_structured_output_retries'] as const)
      expect(replay([], errorResult(subtype))).toMatchObject({ kind: 'invalid_output', retryable: true })
  })

  it('classifies error_during_execution from its error list', () => {
    expect(replay([], errorResult('error_during_execution', ['API Error: 529 overloaded']))?.kind).toBe(
      'unavailable'
    )
    expect(replay([], errorResult('error_during_execution', ['something odd']))).toMatchObject({
      kind: 'unknown',
      message: 'something odd'
    })
  })
})

describe('errorFromThrown', () => {
  const ctx: { aborted: boolean; timedOutAfterMs: number | null } = { aborted: false, timedOutAfterMs: null }
  const thrown = (err: unknown, state: RunState = newRunState(), c = ctx): AiError =>
    errorFromThrown(err, state, c, NOW)

  it('maps a missing executable to non-retryable unavailable', () => {
    const err = thrown(
      new ReferenceError('Claude Code native binary not found at /opt/claude. Please ensure ...')
    )
    expect(err).toMatchObject({ kind: 'unavailable', retryable: false })
  })

  it('maps CLI argument rejections to non-retryable unknown', () => {
    const state = newRunState()
    state.stderr = 'Error: --json-schema is not a valid JSON Schema: no schema with key or ref'
    expect(thrown(new Error('Claude Code process exited with code 1'), state)).toMatchObject({
      kind: 'unknown',
      retryable: false
    })
  })

  it('maps a spawn failure to retryable unavailable', () => {
    expect(thrown(new Error('Failed to spawn Claude Code process: spawn EAGAIN'))).toMatchObject({
      kind: 'unavailable',
      retryable: true
    })
  })

  it('maps aborts to cancelled', () => {
    expect(thrown(new AbortError('Claude Code process aborted by user')).kind).toBe('cancelled')
    expect(thrown(new Error('whatever'), newRunState(), { aborted: true, timedOutAfterMs: null }).kind).toBe(
      'cancelled'
    )
  })

  it('maps our own timeout to retryable unavailable', () => {
    const err = thrown(new AbortError('aborted'), newRunState(), { aborted: false, timedOutAfterMs: 900_000 })
    expect(err).toMatchObject({ kind: 'unavailable', retryable: true })
    expect(err.message).toContain('900 s')
  })

  it('reads auth and limit problems from stderr after a process exit', () => {
    const state = newRunState()
    state.stderr = 'Invalid API key · Please run /login'
    expect(thrown(new Error('Claude Code process exited with code 1'), state).kind).toBe('auth')
    const limited = newRunState()
    limited.stderr = "You've hit your weekly limit · resets Oct 20, 9:30am (UTC)"
    expect(thrown(new Error('Claude Code process exited with code 1'), limited)).toMatchObject({
      kind: 'rate_limited',
      resetAt: '2026-10-20T09:30:00.000Z',
      message: 'Claude Code process exited with code 1'
    })
  })

  it('prefers an assistant error seen before the exception', () => {
    const state = newRunState()
    observeMessage(state, assistantText('Not logged in · Please run /login', 'authentication_failed'))
    expect(thrown(new Error('Claude Code process exited with code 1'), state).kind).toBe('auth')
  })

  it('maps a plain process exit to retryable unavailable, anything else to unknown', () => {
    expect(thrown(new Error('Claude Code process exited with code 137'))).toMatchObject({
      kind: 'unavailable'
    })
    expect(thrown(new Error('weird'))).toMatchObject({ kind: 'unknown', retryable: false })
    const ai = new AiError('refused', 'no')
    expect(thrown(ai)).toBe(ai)
  })
})

describe('classifyText', () => {
  it.each([
    ['Not logged in · Please run /login', 'auth'],
    ['API Error: 401 Invalid API key · Please run /login', 'auth'],
    ["You've hit your session limit · resets 3pm", 'rate_limited'],
    ['API Error: 429 Too Many Requests', 'rate_limited'],
    ['Opus is experiencing high load, please use /model to switch to Sonnet', 'unavailable'],
    ['API Error: 503 Service Unavailable', 'unavailable'],
    ['The document has 500 pages', null]
  ])('%s -> %s', (text, kind) => {
    expect(classifyText(text)).toBe(kind)
  })
})
