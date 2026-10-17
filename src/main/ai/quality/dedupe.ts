import { normalizeText } from './text'

/**
 * Near-duplicate filter for card fronts and question stems. Character trigrams of the
 * normalised text are robust to small rewordings, punctuation and word order changes, which is
 * what repeated generation over the same pages produces.
 */

export const DEFAULT_DEDUPE_THRESHOLD = 0.8

/** Character trigrams of the normalised text, padded so short words still produce grams. */
export function trigrams(text: string): Set<string> {
  const padded = ` ${normalizeText(text)} `
  const grams = new Set<string>()
  for (let i = 0; i + 3 <= padded.length; i++) grams.add(padded.slice(i, i + 3))
  return grams
}

/** Jaccard similarity of two trigram sets (1 = identical, 0 = disjoint). */
export function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]
  let shared = 0
  for (const gram of small) if (large.has(gram)) shared++
  return shared / (a.size + b.size - shared)
}

/**
 * Keeps items whose key text is not similar (>= threshold) to any `existing` text or to an item
 * kept earlier in the batch. Order is preserved; the first of a duplicate group wins.
 */
export function dedupeBy<T>(
  items: readonly T[],
  key: (item: T) => string,
  existing: readonly string[],
  threshold = DEFAULT_DEDUPE_THRESHOLD
): T[] {
  const seen = existing.map(trigrams)
  const kept: T[] = []
  for (const item of items) {
    const grams = trigrams(key(item))
    if (seen.some((other) => jaccard(grams, other) >= threshold)) continue
    seen.push(grams)
    kept.push(item)
  }
  return kept
}
