import { parseResetAt, resetAtFromUnix, zonedTimeToUtc } from './reset-time'

// Saturday 2026-10-17 10:00 UTC = 13:00 in Kyiv (EEST, UTC+3 until 2026-10-25).
const NOW = Date.UTC(2026, 9, 17, 10, 0)

describe('parseResetAt', () => {
  it.each([
    ["You've hit your session limit · resets 3pm (Europe/Kyiv)", '2026-10-17T12:00:00.000Z'],
    ["You've hit your session limit · resets 3:30pm (Europe/Kyiv)", '2026-10-17T12:30:00.000Z'],
    // Already passed today in Kyiv: the next occurrence is tomorrow.
    ["You've hit your session limit · resets 11am (Europe/Kyiv)", '2026-10-18T08:00:00.000Z'],
    ["You've hit your weekly limit · resets Oct 20, 9:30am (UTC)", '2026-10-20T09:30:00.000Z'],
    // After the DST switch Kyiv is UTC+2.
    ["You've hit your Opus limit · resets Oct 26, 3pm (Europe/Kyiv)", '2026-10-26T13:00:00.000Z'],
    // A date without a year that already passed means next year.
    ["You've hit your weekly limit · resets Jan 2, 12am (UTC)", '2027-01-02T00:00:00.000Z'],
    ["You've hit your weekly limit · resets Oct 20, 2027, 12pm (UTC)", '2027-10-20T12:00:00.000Z'],
    ['Claude AI usage limit reached|1760000000', '2025-10-09T08:53:20.000Z'],
    ['limit resets at 2026-10-17T15:45:00Z', '2026-10-17T15:45:00.000Z'],
    ["You've hit your fast limit · resets in 2h 15m", '2026-10-17T12:15:00.000Z'],
    ['resets in 45 minutes', '2026-10-17T10:45:00.000Z']
  ])('%s', (text, expected) => {
    expect(parseResetAt(text, NOW)).toBe(expected)
  })

  it('returns null when the text has no reset time', () => {
    expect(parseResetAt("You've hit your limit", NOW)).toBeNull()
    expect(parseResetAt('API Error: 429 rate_limit_error', NOW)).toBeNull()
  })

  it('falls back to the local zone for an unknown zone name', () => {
    expect(parseResetAt('resets 3pm (Mars/Olympus)', NOW)).not.toBeNull()
  })
})

describe('zonedTimeToUtc', () => {
  it('converts wall-clock time in a zone, including day overflow', () => {
    // 2026-11-01 12:00 is after New York's DST switch that morning (EST, UTC-5).
    expect(zonedTimeToUtc({ year: 2026, month: 10, day: 32, hour: 12, minute: 0 }, 'America/New_York')).toBe(
      Date.UTC(2026, 10, 1, 17, 0)
    )
  })
})

describe('resetAtFromUnix', () => {
  it('converts seconds and ignores missing or invalid values', () => {
    expect(resetAtFromUnix(1760000000)).toBe('2025-10-09T08:53:20.000Z')
    expect(resetAtFromUnix(undefined)).toBeNull()
    expect(resetAtFromUnix(0)).toBeNull()
  })
})
