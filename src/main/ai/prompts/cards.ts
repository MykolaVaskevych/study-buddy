import type { GenerationContext } from '../types'
import { FOCUS_PAGES_KEY, formatRange, headerLines, languageInstruction } from './common'
import { formatManifest, manifestEntries } from './manifest'
import { formatNotes } from './notes'
import { STUDY_SYSTEM } from './study'

/** Flashcards for a page range (smart tier). */

export const CARDS_SYSTEM = STUDY_SYSTEM

/** At most this many existing fronts are listed in the prompt; dedupe in code covers the rest. */
export const MAX_LISTED_EXISTING = 40

const RULES = `Flashcard rules:
- Card types: basic (a question on the front, the answer on the back); cloze (the front is a sentence with gaps written {{c1::answer}}, {{c2::answer}}; the back repeats the full sentence or adds context); formula (the front asks for a formula or what it means; the back gives it as $LaTeX$ and explains every symbol); contrast (the front asks for the difference between two related concepts).
- One idea per card. The front must make sense without seeing the slide. The back is concise (at most about 40 words) and complete.
- Cover what an exam asks: definitions, relationships, formulas and when to use them, typical calculations, classic traps. Skip trivia.
- Do not repeat cards listed under "Already covered".
- essential: true for the must-know core (definitions, key formulas, classic exam facts), false for supporting detail.
- source_pages: the page-stamp numbers the card is based on, all inside the focus pages.
- evidence: a verbatim quote (at most 25 words) copied from the text of a source page that supports the back. If the source page is image-only, briefly describe the figure instead.`

const ESSENTIALS = `Essentials only: create only must-know core cards (definitions, key formulas, classic exam facts). Every card has essential = true. Fewer, high-value cards are better than filler.`

export function buildCardsUser(
  ctx: GenerationContext,
  opts: { count: number; essentialsOnly: boolean; existingFronts: readonly string[] }
): string {
  const existing = opts.existingFronts.slice(0, MAX_LISTED_EXISTING)
  return [
    headerLines({
      Task: 'cards',
      [FOCUS_PAGES_KEY]: formatRange(ctx.pageFrom, ctx.pageTo),
      Count: opts.count,
      Scope: opts.essentialsOnly ? 'essentials' : 'full'
    }),
    `Create up to ${opts.count} flashcards for pages ${ctx.pageFrom}-${ctx.pageTo}. The attached chunks may contain other pages: ignore them.`,
    languageInstruction(ctx.language),
    RULES,
    ...(opts.essentialsOnly ? [ESSENTIALS] : []),
    formatManifest(manifestEntries(ctx.pageFrom, ctx.pageTo, ctx.pageText, 0)),
    formatNotes(ctx.notes),
    existing.length > 0
      ? [
          'Already covered (do not repeat):',
          ...existing.map((f) => `- ${f.replace(/\s+/g, ' ').trim()}`)
        ].join('\n')
      : 'Already covered: nothing yet.'
  ].join('\n\n')
}
