import { z } from 'zod'
import { scopeSchema } from '@shared/ipc/contract'
import { fatal } from './errors'

/**
 * Job payloads. They are written by this module but come back from JSON storage, possibly from an
 * older version of the app, so handlers validate them before use.
 */

const id = z.string().min(1)
const page = z.number().int().min(1)

export const indexChunkPayload = z.strictObject({
  docId: id,
  /** -1 for a retry job, which indexes a focus chunk of pages the first pass skipped. */
  chunkIndex: z.number().int().min(-1),
  startPage: page,
  endPage: page,
  retry: z.boolean().optional()
})
export type IndexChunkPayload = z.infer<typeof indexChunkPayload>

export const topicMapPayload = z.strictObject({ docId: id })
export type TopicMapPayload = z.infer<typeof topicMapPayload>

export const writeLessonPayload = z.strictObject({ docId: id, topicId: id })
export type WriteLessonPayload = z.infer<typeof writeLessonPayload>

export const generateCardsPayload = z.strictObject({
  scope: scopeSchema,
  essentialsOnly: z.boolean(),
  count: z.number().int().min(1).nullable()
})
export type GenerateCardsPayload = z.infer<typeof generateCardsPayload>

export const generateQuestionsPayload = z.strictObject({
  scope: scopeSchema,
  count: z.number().int().min(1),
  types: z.array(z.enum(['mcq', 'multi', 'tf', 'short', 'numeric'])).nullable(),
  purpose: z.enum(['quiz', 'mock'])
})
export type GenerateQuestionsPayload = z.infer<typeof generateQuestionsPayload>

export const pageCheckPayload = z.strictObject({ docId: id, page })
export type PageCheckPayload = z.infer<typeof pageCheckPayload>

/** Parses a stored payload; a malformed one can never succeed, so the job fails without retries. */
export function parsePayload<T>(schema: z.ZodType<T>, raw: unknown): T {
  const parsed = schema.safeParse(raw)
  if (!parsed.success) throw fatal(`Invalid job payload: ${parsed.error.message}`)
  return parsed.data
}
