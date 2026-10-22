import type { LlmProvider } from '@shared/ai/provider'
import { cardsOutputSchema, type CardsOutput } from '@shared/ai/schemas'
import { chunkParts } from '../prompts/common'
import { CARDS_SYSTEM, buildCardsUser } from '../prompts/cards'
import { dedupeBy } from '../quality/dedupe'
import { groundItem } from '../quality/grounding'
import type { CardDraft, GenerationContext, PageTextLookup, WithUsage } from '../types'
import { weakBatch } from '../routing'
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

/**
 * Flashcards for one window. Every card must quote the page (grounding) and differ from the
 * existing ones. When `strong` is given (the routing put cards on the fast model) and the batch is
 * weak, it is made once more on the strong model, keeping the good cards of the first try.
 */
export async function generateCards(
  provider: LlmProvider,
  ctx: GenerationContext,
  opts: { count: number; essentialsOnly: boolean; existingFronts: string[] },
  settings: ResolvedOptions,
  strong: LlmProvider | null = null
): Promise<WithUsage<CardDraft[]>> {
  if (opts.count <= 0) return { value: [], usage: [] }
  const chunks = selectChunks(ctx.chunks, ctx.pageFrom, ctx.pageTo, settings)
  const range = { from: ctx.pageFrom, to: ctx.pageTo }
  const attempt = async (p: LlmProvider, existing: readonly string[]) => {
    const res = await p.generate({
      task: 'cards',
      system: CARDS_SYSTEM,
      parts: [...chunkParts(chunks), { type: 'text', text: buildCardsUser(ctx, opts) }],
      schema: cardsOutputSchema,
      tier: 'smart',
      effort: 'medium',
      ...(ctx.signal === undefined ? {} : { signal: ctx.signal })
    })
    const drafts = res.data.cards
      .map((c) =>
        toCardDraft(c, range, ctx.pageText, { ...opts, groundingThreshold: settings.groundingThreshold })
      )
      .filter((d): d is CardDraft => d !== null)
    const unique = dedupeBy(drafts, (d) => d.front, [...existing], settings.dedupeThreshold)
    return { returned: res.data.cards.length, unique, usage: usageRecord('cards', res) }
  }
  const first = await attempt(provider, opts.existingFronts)
  const good = first.unique.filter((d) => d.verification !== 'unverified')
  if (!strong || !weakBatch(first.returned, good.length, opts.count))
    return { value: first.unique.slice(0, opts.count), usage: [first.usage] }
  // Cards whose quote was not found on the page only fill up after the strong model's.
  const second = await attempt(strong, [...opts.existingFronts, ...good.map((d) => d.front)])
  const weak = first.unique.filter((d) => d.verification === 'unverified')
  return {
    value: [...good, ...second.unique, ...weak].slice(0, opts.count),
    usage: [first.usage, second.usage]
  }
}
