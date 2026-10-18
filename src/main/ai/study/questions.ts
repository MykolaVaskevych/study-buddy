import { questionTypesFor } from '../prompts/exam-profile'
import type { QuestionType } from '@shared/domain'
import type { LlmProvider, PromptPart } from '@shared/ai/provider'
import { questionsOutputSchema, verifyOutputSchema } from '@shared/ai/schemas'
import { chunkParts } from '../prompts/common'
import { QUESTIONS_SYSTEM, buildQuestionsUser, type QuestionPurpose } from '../prompts/questions'
import { VERIFY_SYSTEM, buildVerifyUser, type BlindQuestion } from '../prompts/verify'
import { dedupeBy } from '../quality/dedupe'
import { groundItem } from '../quality/grounding'
import { convertQuestion } from '../quality/questions'
import { VERIFIABLE_TYPES, applyBlindAnswers, verifyId } from '../quality/verify'
import type { GenerationContext, QuestionDraft, UsageRecord, WithUsage } from '../types'
import { selectChunks, usageRecord, type ResolvedOptions } from './common'

/**
 * Question generation: one smart-tier call, then conversion of the flattened answer fields,
 * grounding, de-duplication and (optionally) the blind answer-key check. Order matters for
 * cost: duplicates and ungrounded items are removed before the verification call.
 */

export interface QuestionOptions {
  count: number
  types: QuestionType[] | null
  purpose: QuestionPurpose
  existingStems: string[]
  verify: boolean
}

/** The blind pass: same PDFs, questions without keys, comparison in code. */
export async function verifyQuestions(
  provider: LlmProvider,
  drafts: readonly QuestionDraft[],
  pdfParts: readonly PromptPart[],
  range: { from: number; to: number },
  signal: AbortSignal | undefined
): Promise<{ kept: QuestionDraft[]; usage: UsageRecord[] }> {
  const blind: BlindQuestion[] = drafts
    .map((d, i) => ({ id: verifyId(i), type: d.type, stem: d.stem, options: d.options }))
    .filter((q) => VERIFIABLE_TYPES.has(q.type))
  if (blind.length === 0) return { kept: [...drafts], usage: [] }
  const res = await provider.generate({
    task: 'verify',
    system: VERIFY_SYSTEM,
    parts: [...pdfParts, { type: 'text', text: buildVerifyUser(range, blind) }],
    schema: verifyOutputSchema,
    tier: 'smart',
    effort: 'low',
    ...(signal === undefined ? {} : { signal })
  })
  return { kept: applyBlindAnswers(drafts, res.data), usage: [usageRecord('verify', res)] }
}

export async function generateQuestions(
  provider: LlmProvider,
  ctx: GenerationContext,
  opts: QuestionOptions,
  settings: ResolvedOptions
): Promise<WithUsage<QuestionDraft[]>> {
  if (opts.count <= 0) return { value: [], usage: [] }
  const pdfParts = chunkParts(selectChunks(ctx.chunks, ctx.pageFrom, ctx.pageTo, settings))
  const task = opts.purpose === 'page_check' ? 'page_check' : 'questions'
  const res = await provider.generate({
    task,
    system: QUESTIONS_SYSTEM,
    parts: [...pdfParts, { type: 'text', text: buildQuestionsUser(ctx, opts) }],
    schema: questionsOutputSchema,
    tier: 'smart',
    effort: 'medium',
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal })
  })
  const range = { from: ctx.pageFrom, to: ctx.pageTo }
  const drafts: QuestionDraft[] = []
  for (const raw of res.data.questions) {
    // Types the exam does not use are dropped even if the model produced them.
    const converted = convertQuestion(raw, opts.types ?? (ctx.exam ? questionTypesFor(ctx.exam) : null))
    if (converted === null) continue
    const grounded = groundItem(converted, range, ctx.pageText, settings.groundingThreshold)
    if (grounded !== null) drafts.push({ ...converted, ...grounded })
  }
  const unique = dedupeBy(drafts, (d) => d.stem, opts.existingStems, settings.dedupeThreshold).slice(
    0,
    opts.count
  )
  const usage = [usageRecord(task, res)]
  if (!opts.verify) return { value: unique, usage }
  const verified = await verifyQuestions(provider, unique, pdfParts, range, ctx.signal)
  return { value: verified.kept, usage: [...usage, ...verified.usage] }
}
