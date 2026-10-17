/** Terms shorter than this match exactly; longer ones also match as a prefix ("fib" finds "fiber"). */
const PREFIX_MIN_LENGTH = 3
/** A search box query never needs more; caps the cost of pathological input. */
const MAX_TERMS = 12

/**
 * Turns free text from a search box into a safe FTS5 MATCH expression.
 *
 * User input is never passed through as FTS syntax: operators (AND/OR/NOT/NEAR), column filters,
 * `^`, `*` and unbalanced quotes would either throw or change the meaning. Instead every
 * whitespace-separated word becomes one quoted phrase made of its letter/number runs, which mirrors
 * how the unicode61 tokenizer splits text ("TCP/IP" -> "TCP IP", "e-mail" -> "e mail"). Phrases are
 * ANDed (FTS5's implicit operator). Returns null when nothing searchable is left.
 */
export function toFtsQuery(input: string): string | null {
  const phrases: string[] = []
  for (const word of input.normalize('NFC').split(/\s+/u)) {
    const tokens = word.match(/[\p{L}\p{N}]+/gu)
    if (!tokens) continue
    const phrase = tokens.join(' ')
    const last = tokens[tokens.length - 1] ?? ''
    // Tokens contain only letters/digits, so no quote can appear inside the phrase.
    phrases.push(last.length >= PREFIX_MIN_LENGTH ? `"${phrase}"*` : `"${phrase}"`)
    if (phrases.length >= MAX_TERMS) break
  }
  return phrases.length > 0 ? phrases.join(' ') : null
}
