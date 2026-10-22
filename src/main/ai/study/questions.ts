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
import { weakBatch } from '../routing'
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
  settings: ResolvedOptions,
  strong: LlmProvider | null = null
): Promise<WithUsage<QuestionDraft[]>> {
  if (opts.count <= 0) return { value: [], usage: [] }
  const pdfParts = chunkParts(selectChunks(ctx.chunks, ctx.pageFrom, ctx.pageTo, settings))
  const task = opts.purpose === 'page_check' ? 'page_check' : 'questions'
  const range = { from: ctx.pageFrom, to: ctx.pageTo }
  const attempt = async (p: LlmProvider, existing: readonly string[]) => {
    const res = await p.generate({
      task,
      system: QUESTIONS_SYSTEM,
      parts: [...pdfParts, { type: 'text', text: buildQuestionsUser(ctx, opts) }],
      schema: questionsOutputSchema,
      tier: 'smart',
      effort: 'medium',
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal })
    })
    const drafts: QuestionDraft[] = []
    for (const raw of res.data.questions) {
      // Types the exam does not use are dropped even if the model produced them.
      const converted = convertQuestion(raw, opts.types ?? (ctx.exam ? questionTypesFor(ctx.exam) : null))
      if (converted === null) continue
      const grounded = groundItem(converted, range, ctx.pageText, settings.groundingThreshold)
      if (grounded !== null) drafts.push({ ...converted, ...grounded })
    }
    const unique = dedupeBy(drafts, (d) => d.stem, [...existing], settings.dedupeThreshold)
    return { returned: res.data.questions.length, unique, usage: usageRecord(task, res) }
  }
  const first = await attempt(provider, opts.existingStems)
  const good = first.unique.filter((d) => d.verification !== 'unverified')
  // A weak fast-model batch is made once more on the strong model, keeping its good questions first.
  const second =
    strong && weakBatch(first.returned, good.length, opts.count)
      ? await attempt(strong, [...opts.existingStems, ...good.map((d) => d.stem)])
      : null
  const weak = first.unique.filter((d) => d.verification === 'unverified')
  const unique = (second ? [...good, ...second.unique, ...weak] : first.unique).slice(0, opts.count)
  const usage = [first.usage, ...(second ? [second.usage] : [])]
  if (!opts.verify) return { value: unique, usage }
  const verified = await verifyQuestions(provider, unique, pdfParts, range, ctx.signal)
  return { value: verified.kept, usage: [...usage, ...verified.usage] }
}
