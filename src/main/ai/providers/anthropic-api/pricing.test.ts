import { costUsd, priceFor } from './pricing'

const tokens = (input: number, output: number, cacheRead = 0, cacheWrite = 0) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: cacheRead,
  cacheWriteTokens: cacheWrite
})

describe('costUsd', () => {
  it('prices Opus 5.5 at $4 in / $20 out, $0.20 cache read, 1.25x cache write', () => {
    expect(costUsd('claude-opus-5-5', tokens(1_000_000, 0))).toBeCloseTo(4)
    expect(costUsd('claude-opus-5-5', tokens(0, 1_000_000))).toBeCloseTo(20)
    expect(costUsd('claude-opus-5-5', tokens(0, 0, 1_000_000))).toBeCloseTo(0.2)
    expect(costUsd('claude-opus-5-5', tokens(0, 0, 0, 1_000_000))).toBeCloseTo(5)
  })

  it('prices Haiku 5.5 at $0.10 / $0.50 with 0.1x read and 1.25x write', () => {
    expect(costUsd('claude-haiku-5-5', tokens(20_000, 4_000, 10_000, 8_000))).toBeCloseTo(
      (20_000 * 0.1 + 4_000 * 0.5 + 10_000 * 0.01 + 8_000 * 0.125) / 1e6
    )
  })

  it('uses the Haiku long-context tier above 100K prompt tokens', () => {
    expect(costUsd('claude-haiku-5-5', tokens(150_000, 1_000))).toBeCloseTo(
      (150_000 * 0.5 + 1_000 * 2.5) / 1e6
    )
  })

  it('prices Sonnet 5.5 at $2 / $10', () => {
    expect(costUsd('claude-sonnet-5-5', tokens(1_000_000, 1_000_000))).toBeCloseTo(12)
  })

  it('returns null for unknown models and matches dated variants by prefix', () => {
    expect(costUsd('gpt-x', tokens(1, 1))).toBeNull()
    expect(priceFor('claude-opus-5-5-20260901')).toBe(priceFor('claude-opus-5-5'))
  })
})
