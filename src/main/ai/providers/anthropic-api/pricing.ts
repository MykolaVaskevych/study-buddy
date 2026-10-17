/**
 * List prices (USD per million tokens) for computing the cost of BYOK calls, which feeds the
 * monthly budget cap. Cache writes are the 5-minute TTL (1.25x input). Claude Haiku 5.5 has a
 * higher tier for prompts above 100K tokens.
 */

export interface ModelPrice {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  /** Prices applied when the whole prompt exceeds `threshold` input tokens. */
  longContext?: { threshold: number; input: number; output: number }
}

export const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  'claude-haiku-5-5': {
    input: 0.1,
    output: 0.5,
    cacheRead: 0.01,
    cacheWrite: 0.125,
    longContext: { threshold: 100_000, input: 0.5, output: 2.5 }
  }
}

export interface TokenCounts {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
}

/** Exact id first, then the longest known id the model starts with (e.g. dated variants). */
export function priceFor(model: string): ModelPrice | null {
  const exact = PRICES[model]
  if (exact) return exact
  const prefix = Object.keys(PRICES)
    .filter((id) => model.startsWith(id))
    .sort((a, b) => b.length - a.length)[0]
  return prefix === undefined ? null : (PRICES[prefix] ?? null)
}

/** Dollar cost of one call, or null for a model missing from the table. */
export function costUsd(model: string, t: TokenCounts): number | null {
  const price = priceFor(model)
  if (price === null) return null
  const promptTokens = t.inputTokens + t.cacheReadTokens + t.cacheWriteTokens
  const long = price.longContext !== undefined && promptTokens > price.longContext.threshold
  const input = long && price.longContext ? price.longContext.input : price.input
  const output = long && price.longContext ? price.longContext.output : price.output
  // Cache rates scale with the input rate of the tier that applies.
  const cacheRead = price.cacheRead * (input / price.input)
  const cacheWrite = price.cacheWrite * (input / price.input)
  const dollars =
    t.inputTokens * input +
    t.outputTokens * output +
    t.cacheReadTokens * cacheRead +
    t.cacheWriteTokens * cacheWrite
  return dollars / 1_000_000
}
