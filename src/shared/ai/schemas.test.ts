import { z } from 'zod'
import {
  cardsOutputSchema,
  indexChunkOutputSchema,
  questionsOutputSchema,
  topicMapOutputSchema,
  verifyOutputSchema,
  gradeOutputSchema
} from './schemas'

/** Structured-output rules: every object closed and every property required (nullable, never optional). */
function assertStrict(node: unknown, path = '$'): void {
  if (!node || typeof node !== 'object') return
  const obj = node as Record<string, unknown>
  if (obj['type'] === 'object') {
    expect(obj['additionalProperties'], `${path} must be closed`).toBe(false)
    const props = Object.keys((obj['properties'] as Record<string, unknown>) ?? {})
    expect([...((obj['required'] as string[]) ?? [])].sort(), `${path} all props required`).toEqual(
      [...props].sort()
    )
  }
  for (const [k, v] of Object.entries(obj)) assertStrict(v, `${path}.${k}`)
}

describe('AI output schemas', () => {
  it.each([
    ['index', indexChunkOutputSchema],
    ['topics', topicMapOutputSchema],
    ['cards', cardsOutputSchema],
    ['questions', questionsOutputSchema],
    ['grade', gradeOutputSchema],
    ['verify', verifyOutputSchema]
  ])('%s schema is structured-output compatible', (_name, schema) => {
    assertStrict(z.toJSONSchema(schema))
  })
})
