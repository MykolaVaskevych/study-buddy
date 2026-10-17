/**
 * Deterministic "answer keys" shared by the fake question generator and the fake blind
 * verifier. The verifier only sees stems and options, so both derive the key from the stem;
 * this makes the fake verification pass agree with the fake generator, as a good model would.
 */

/** FNV-1a 32-bit hash: stable across runs and platforms. */
export function hash(text: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h
}

function canonical(stem: string): string {
  return stem.replace(/\s+/g, ' ').trim()
}

/** Index of the correct option of an mcq. */
export function mcqKey(stem: string, optionCount: number): number {
  return hash(canonical(stem)) % optionCount
}

/** Correct options of a multi question: two options, two apart. */
export function multiKey(stem: string, optionCount: number): number[] {
  const first = mcqKey(stem, optionCount)
  return [first, (first + 2) % optionCount].sort((a, b) => a - b)
}

export const FALSE_STATEMENT_PREFIX = 'True or false: It is not the case that '
export const TF_PREFIX = 'True or false: '

/** A tf statement is false exactly when it was written with the negation prefix. */
export function tfKey(stem: string): boolean | null {
  const text = canonical(stem)
  if (text.startsWith(FALSE_STATEMENT_PREFIX)) return false
  return text.startsWith(TF_PREFIX) ? true : null
}

/** Numeric stems ask for "$a \times b$"; the key is the product. */
export function numericKey(stem: string): number | null {
  const match = /\$(\d+) \\times (\d+)\$/.exec(stem)
  return match?.[1] === undefined || match[2] === undefined ? null : Number(match[1]) * Number(match[2])
}
