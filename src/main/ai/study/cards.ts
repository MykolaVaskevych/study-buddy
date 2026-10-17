import type { LlmProvider } from '@shared/ai/provider'
import { cardsOutputSchema, type CardsOutput } from '@shared/ai/schemas'
import { chunkParts } from '../prompts/common'
import { CARDS_SYSTEM, buildCardsUser } from '../prompts/cards'
import { dedupeBy } from '../quality/dedupe'
import { groundItem } from '../quality/grounding'
import type { CardDraft, GenerationContext, PageTextLookup, WithUsage } from '../types'
import { selectChunks, usageRecord, type ResolvedOptions } from './common'

type RawCard = CardsOutput['cards'][number]

const CLOZE_GAP = /\{\{c\d+::[^}]+\}\}/

/**
 * One raw card to a draft, or null when it is empty or cannot be traced to a focus page.
 * A "cloze" card without any gap is really a basic question, so its type is corrected.
 */
export function toCardDraft(
  raw: RawCard,
  range: { from: number; to: number },
  pageText: PageTextLookup,
  opts: { essentialsOnly: boolean; groundingThreshold: number }
): CardDraft | null {
  const front = raw.front.trim()
  const back = raw.back.trim()
  if (front === '' || back === '') return null
  const grounded = groundItem(
    { sourcePages: raw.source_pages, evidence: raw.evidence },
    range,
    pageText,
    opts.groundingThreshold
  )
  if (grounded === null) return null
  return {
    type: raw.type === 'cloze' && !CLOZE_GAP.test(front) ? 'basic' : raw.type,
    front,
    back,
    essential: opts.essentialsOnly || raw.essential,
    ...grounded
  }
}

export async function generateCards(
  provider: LlmProvider,
  ctx: GenerationContext,
  opts: { count: number; essentialsOnly: boolean; existingFronts: string[] },
  settings: ResolvedOptions
): Promise<WithUsage<CardDraft[]>> {
  if (opts.count <= 0) return { value: [], usage: [] }
  const chunks = selectChunks(ctx.chunks, ctx.pageFrom, ctx.pageTo, settings)
  const res = await provider.generate({
    task: 'cards',
    system: CARDS_SYSTEM,
    parts: [...chunkParts(chunks), { type: 'text', text: buildCardsUser(ctx, opts) }],
    schema: cardsOutputSchema,
    tier: 'smart',
    effort: 'medium',
    ...(ctx.signal === undefined ? {} : { signal: ctx.signal })
  })
  const range = { from: ctx.pageFrom, to: ctx.pageTo }
  const drafts = res.data.cards
    .map((c) =>
      toCardDraft(c, range, ctx.pageText, { ...opts, groundingThreshold: settings.groundingThreshold })
    )
    .filter((d): d is CardDraft => d !== null)
  const unique = dedupeBy(drafts, (d) => d.front, opts.existingFronts, settings.dedupeThreshold)
  return { value: unique.slice(0, opts.count), usage: [usageRecord('cards', res)] }
}
