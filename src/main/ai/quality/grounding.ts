import type { Verification } from '@shared/domain'
import type { PageTextLookup } from '../types'
import { normalizeText, tokens } from './text'

/**
 * Grounding check: is the item's evidence quote really on one of its source pages?
 * The model is asked for a short verbatim quote, but the PDF text layer differs from what it
 * writes (hyphenation, ligatures, LaTeX vs plain symbols, small omissions), so the match is fuzzy:
 *  1. compact containment: the normalised quote without spaces is a substring of the page;
 *  2. otherwise the best window of page words covers >= `threshold` of the quote's words.
 * Very short quotes (< 3 words) must match by containment, because word overlap is meaningless.
 */

export const DEFAULT_GROUNDING_THRESHOLD = 0.8

/** Fuzzy containment of `quote` in `pageText`; see the module comment. */
export function quoteMatches(
  quote: string,
  pageText: string,
  threshold = DEFAULT_GROUNDING_THRESHOLD
): boolean {
  const quoteNorm = normalizeText(quote)
  const pageNorm = normalizeText(pageText)
  if (quoteNorm === '' || pageNorm === '') return false
  if (pageNorm.replaceAll(' ', '').includes(quoteNorm.replaceAll(' ', ''))) return true

  const quoteWords = quoteNorm.split(' ')
  if (quoteWords.length < 3) return false
  return bestWindowOverlap(quoteWords, pageNorm.split(' ')) / quoteWords.length >= threshold
}

/**
 * Largest multiset overlap between the quote words and any window of page words. The window is
 * 25 % longer than the quote so a few inserted words on the page (e.g. a line break artefact)
 * do not break the match. Sliding counts keep this linear in the page length.
 */
export function bestWindowOverlap(quoteWords: readonly string[], pageWords: readonly string[]): number {
  const need = new Map<string, number>()
  for (const word of quoteWords) need.set(word, (need.get(word) ?? 0) + 1)
  const width = Math.ceil(quoteWords.length * 1.25)
  const window = new Map<string, number>()
  let overlap = 0
  let best = 0
  for (let i = 0; i < pageWords.length; i++) {
    const added = pageWords[i] ?? ''
    const addedCount = (window.get(added) ?? 0) + 1
    window.set(added, addedCount)
    if (addedCount <= (need.get(added) ?? 0)) overlap++
    if (i >= width) {
      const removed = pageWords[i - width] ?? ''
      const removedCount = window.get(removed) ?? 0
      if (removedCount <= (need.get(removed) ?? 0)) overlap--
      window.set(removed, removedCount - 1)
    }
    if (overlap > best) best = overlap
  }
  return best
}

/** Integer pages inside [from, to], de-duplicated and sorted. */
export function validPages(pages: readonly number[], from: number, to: number): number[] {
  const valid = pages.filter((p) => Number.isInteger(p) && p >= from && p <= to)
  return [...new Set(valid)].sort((a, b) => a - b)
}

/**
 * Verification state of an item:
 *  - 'not_applicable' when every source page is image-only (empty text layer): nothing to match;
 *  - 'verified' when the quote matches a source page that has a text layer;
 *  - 'unverified' otherwise (including a missing quote).
 */
export function verifyEvidence(
  evidence: string | null,
  sourcePages: readonly number[],
  pageText: PageTextLookup,
  threshold = DEFAULT_GROUNDING_THRESHOLD
): Verification {
  const textPages = sourcePages.map((p) => pageText(p)).filter((text) => tokens(text).length > 0)
  if (textPages.length === 0) return 'not_applicable'
  if (evidence === null || evidence.trim() === '') return 'unverified'
  return textPages.some((text) => quoteMatches(evidence, text, threshold)) ? 'verified' : 'unverified'
}

export interface GroundedFields {
  sourcePages: number[]
  evidence: string | null
  verification: Verification
}

/**
 * Grounds one generated item: drops source pages outside the focus range and returns null when
 * no valid page is left (the item cannot be traced to the pages it was generated from).
 */
export function groundItem(
  item: { sourcePages: readonly number[]; evidence: string },
  range: { from: number; to: number },
  pageText: PageTextLookup,
  threshold = DEFAULT_GROUNDING_THRESHOLD
): GroundedFields | null {
  const sourcePages = validPages(item.sourcePages, range.from, range.to)
  if (sourcePages.length === 0) return null
  const evidence = item.evidence.trim() === '' ? null : item.evidence.trim()
  return { sourcePages, evidence, verification: verifyEvidence(evidence, sourcePages, pageText, threshold) }
}
