import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKRateLimitInfo,
  SDKResultError,
  SDKResultSuccess
} from '@anthropic-ai/claude-agent-sdk'

/**
 * Recorded-shape Agent SDK messages for tests (fields as in sdk.d.ts 0.3.302; texts as the
 * bundled CLI writes them). Only the fields the provider reads are filled in, so each builder
 * casts once here instead of in every test.
 */

const ids = { uuid: '00000000-0000-4000-8000-000000000000', session_id: 'test-session' }

export function initMessage(model = 'claude-haiku-5-5', apiKeySource = 'none'): SDKMessage {
  return { type: 'system', subtype: 'init', model, apiKeySource, tools: [], ...ids } as unknown as SDKMessage
}

export function rateLimitEvent(info: SDKRateLimitInfo): SDKMessage {
  return { type: 'rate_limit_event', rate_limit_info: info, ...ids } as unknown as SDKMessage
}

export function assistantText(text: string, error?: SDKAssistantMessageError): SDKMessage {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    ...(error === undefined ? {} : { error }),
    message: { role: 'assistant', content: [{ type: 'text', text }], stop_reason: null },
    ...ids
  } as unknown as SDKMessage
}

export function textDelta(text: string): SDKMessage {
  return {
    type: 'stream_event',
    parent_tool_use_id: null,
    event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    ...ids
  } as unknown as SDKMessage
}

export function refusalNotice(content: string): SDKMessage {
  return {
    type: 'system',
    subtype: 'model_refusal_no_fallback',
    original_model: 'claude-opus-5-5',
    request_id: null,
    content,
    ...ids
  } as unknown as SDKMessage
}

export function successResult(over: Partial<SDKResultSuccess> = {}): SDKResultSuccess {
  return {
    type: 'result',
    subtype: 'success',
    duration_ms: 7800,
    duration_api_ms: 7000,
    is_error: false,
    num_turns: 2,
    result: '',
    stop_reason: 'end_turn',
    total_cost_usd: 0.0123,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_read_input_tokens: 10,
      cache_creation_input_tokens: 5
    },
    modelUsage: {
      'claude-haiku-5-5': {
        inputTokens: 1200,
        outputTokens: 300,
        cacheReadInputTokens: 400,
        cacheCreationInputTokens: 50,
        webSearchRequests: 0,
        costUSD: 0.0123,
        contextWindow: 1_000_000,
        maxOutputTokens: 32_000
      }
    },
    permission_denials: [],
    ...ids,
    ...over
  } as unknown as SDKResultSuccess
}

export function errorResult(subtype: SDKResultError['subtype'], errors: string[] = []): SDKResultError {
  return {
    type: 'result',
    subtype,
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 3,
    stop_reason: null,
    total_cost_usd: 0,
    usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    modelUsage: {},
    permission_denials: [],
    errors,
    ...ids
  } as unknown as SDKResultError
}
