/**
 * Text normalisation shared by the grounding and dedupe checks. Both compare model output with
 * the PDF text layer, which differs from what the model writes in case, punctuation, ligatures,
 * line-end hyphenation and LaTeX markup, so everything is folded to plain lowercase words.
 */

const LINE_HYPHEN = /(\p{L})[-­]\s+(\p{L})/gu
const NON_WORD = /[^\p{L}\p{N}]+/gu
const COMBINING_MARKS = /\p{M}+/gu

/**
 * Lowercase, NFKC (folds ligatures such as "ﬁ"), drop diacritics, re-join words hyphenated at
 * a line break, strip punctuation/LaTeX markup and collapse whitespace.
 */
export function normalizeText(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .replace(LINE_HYPHEN, '$1$2')
    .normalize('NFKD')
    .replace(COMBINING_MARKS, '')
    .replace(NON_WORD, ' ')
    .trim()
}

/** Normalised words of a string. */
export function tokens(input: string): string[] {
  const normalized = normalizeText(input)
  return normalized === '' ? [] : normalized.split(' ')
}

/** Clamp a number into [min, max]; non-finite values become `fallback`. */
export function clamp(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback
  return Math.min(max, Math.max(min, value))
}

/** Trim strings, drop empty ones, de-duplicate (case-insensitive) and keep at most `max`. */
export function cleanStrings(values: readonly string[], max: number): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of values) {
    const value = raw.trim()
    const key = value.toLowerCase()
    if (value === '' || seen.has(key)) continue
    seen.add(key)
    out.push(value)
    if (out.length >= max) break
  }
  return out
}
