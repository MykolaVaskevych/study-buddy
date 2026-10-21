import { access } from 'node:fs/promises'
import { basename } from 'node:path'
import { z } from 'zod'
import {
  AiError,
  type AiTask,
  type GenerateRequest,
  type GenerateResult,
  type HealthResult,
  type LlmProvider,
  type PromptPart,
  type StreamEvent,
  type StreamRequest,
  type Usage
} from '@shared/ai/provider'
import {
  fakeCards,
  fakeGrade,
  fakeIndex,
  fakeLesson,
  fakeNaming,
  fakePortal,
  fakeQuestions,
  fakeTopics,
  fakeVerify
} from './generators'

/**
 * Offline provider for tests and the `--smoke` run. Output is a pure function of the request, so
 * runs are reproducible. Like the real providers it fails on unreadable PDF parts and on aborted
 * signals, so pipeline bugs show up in tests rather than only with a real model.
 */

export const FAKE_MODEL = 'fake'

export interface FakeDeps {
  /** Resolves when the PDF part exists (default: fs.access). */
  checkFile?: (path: string) => Promise<void>
}

const ZERO_USAGE: Usage = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  costUsd: 0,
  notional: true
}

const BY_TASK: Partial<Record<AiTask, (text: string) => unknown>> = {
  index: fakeIndex,
  topics: fakeTopics,
  cards: fakeCards,
  questions: fakeQuestions,
  page_check: fakeQuestions,
  verify: fakeVerify,
  grade: fakeGrade,
  lesson: fakeLesson,
  naming: fakeNaming,
  portal: fakePortal
}

/** Minimal value satisfying a JSON schema; covers tasks without a dedicated generator. */
export function sampleFromJsonSchema(schema: unknown): unknown {
  if (typeof schema !== 'object' || schema === null) return null
  const node = new Map(Object.entries(schema))
  const rawType = node.get('type')
  // Nullable fields come as type: ['string', 'null']; prefer the non-null member.
  const type = Array.isArray(rawType) ? (rawType.find((t) => t !== 'null') ?? 'null') : rawType
  const anyOf = node.get('anyOf')
  if (Array.isArray(anyOf)) return sampleFromJsonSchema(anyOf.find((s) => !isNullSchema(s)) ?? anyOf[0])
  const enumValues = node.get('enum')
  if (Array.isArray(enumValues)) return enumValues[0] ?? null
  switch (type) {
    case 'object': {
      const properties = node.get('properties')
      if (typeof properties !== 'object' || properties === null) return {}
      return Object.fromEntries(Object.entries(properties).map(([k, v]) => [k, sampleFromJsonSchema(v)]))
    }
    case 'array':
      return []
    case 'string':
      return 'fake'
    case 'number':
    case 'integer':
      return 1
    case 'boolean':
      return true
    case 'null':
      return null
    default:
      return null
  }
}

function isNullSchema(schema: unknown): boolean {
  return typeof schema === 'object' && schema !== null && 'type' in schema && schema.type === 'null'
}

function promptText(parts: readonly PromptPart[]): string {
  return parts
    .map((p) => (p.type === 'text' ? p.text : ''))
    .filter((t) => t !== '')
    .join('\n\n')
}

export function createFakeProvider(deps: FakeDeps = {}): LlmProvider {
  const checkFile = deps.checkFile ?? ((path: string) => access(path))

  async function prepare(parts: readonly PromptPart[], signal: AbortSignal | undefined): Promise<string> {
    if (signal?.aborted) throw new AiError('cancelled', 'Request cancelled')
    for (const part of parts) {
      if (part.type !== 'pdf') continue
      try {
        await checkFile(part.path)
      } catch (cause) {
        throw new AiError('unknown', `Cannot read PDF part ${basename(part.path)}`, {
          retryable: false,
          cause
        })
      }
    }
    return promptText(parts)
  }

  return {
    id: 'fake',
    capabilities: { promptCaching: false, batch: false, maxPdfPages: 1000 },

    async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const text = await prepare(req.parts, req.signal)
      const generator = BY_TASK[req.task]
      const candidate = generator ? generator(text) : sampleFromJsonSchema(z.toJSONSchema(req.schema))
      const parsed = req.schema.safeParse(candidate)
      if (!parsed.success)
        throw new AiError(
          'invalid_output',
          `Fake output for task '${req.task}' does not match the requested schema`
        )
      return { data: parsed.data, usage: ZERO_USAGE, model: FAKE_MODEL }
    },

    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      const text = await prepare(req.parts, req.signal)
      const reply = `Offline fake reply. You asked: ${text.replace(/\s+/g, ' ').trim().slice(0, 160)}`
      for (const word of reply.split(' ')) {
        if (req.signal?.aborted) throw new AiError('cancelled', 'Request cancelled')
        yield { type: 'text', text: `${word} ` }
      }
      yield { type: 'done', usage: ZERO_USAGE, model: FAKE_MODEL }
    },

    async health(): Promise<HealthResult> {
      return {
        ok: true,
        provider: 'fake',
        model: FAKE_MODEL,
        latencyMs: 0,
        message: 'Offline fake provider.'
      }
    }
  }
}
