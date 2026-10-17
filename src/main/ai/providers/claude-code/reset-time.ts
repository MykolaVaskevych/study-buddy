/**
 * Parses when a Claude subscription limit resets from the text Claude Code puts in its error
 * messages. The structured `rate_limit_event` (unix `resetsAt`) is preferred when present; this
 * is the fallback. Known shapes:
 *  - "You've hit your session limit · resets 3pm (Europe/Kyiv)"        wall-clock time, next occurrence
 *  - "You've hit your weekly limit · resets Oct 20, 9:30am (UTC)"      date + time (year optional)
 *  - "Claude AI usage limit reached|1760000000"                        legacy: unix seconds after a pipe
 *  - "... resets in 2h 15m"                                            relative
 *  - an ISO-8601 timestamp anywhere in the text
 * The CLI formats times with an IANA zone in parentheses; without one the local zone is used.
 */

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const HOUR_MS = 3_600_000
const DAY_MS = 24 * HOUR_MS

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
}

function formatter(timeZone: string | undefined): Intl.DateTimeFormat {
  const options: Intl.DateTimeFormatOptions = {
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  }
  try {
    return new Intl.DateTimeFormat('en-US', { ...options, timeZone })
  } catch {
    // Unknown zone name: fall back to the system zone, which is what the CLI uses by default.
    return new Intl.DateTimeFormat('en-US', options)
  }
}

function zonedParts(utcMs: number, timeZone: string | undefined): ZonedParts {
  const parts = new Map<string, string>(
    formatter(timeZone)
      .formatToParts(new Date(utcMs))
      .map((p) => [p.type, p.value])
  )
  const num = (type: string): number => Number(parts.get(type) ?? '0')
  return {
    year: num('year'),
    month: num('month'),
    day: num('day'),
    hour: num('hour') % 24,
    minute: num('minute'),
    second: num('second')
  }
}

/** Offset of the zone from UTC at a given instant, in ms. */
function offsetMs(utcMs: number, timeZone: string | undefined): number {
  const p = zonedParts(utcMs, timeZone)
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return asUtc - Math.floor(utcMs / 1000) * 1000
}

/** UTC instant of a wall-clock time in a zone (handles DST by re-checking the offset). */
export function zonedTimeToUtc(
  wall: { year: number; month: number; day: number; hour: number; minute: number },
  timeZone: string | undefined
): number {
  const guess = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute)
  const first = guess - offsetMs(guess, timeZone)
  const second = guess - offsetMs(first, timeZone)
  return second
}

function to24h(hour: number, meridiem: string): number {
  const pm = meridiem.toLowerCase() === 'pm'
  if (hour === 12) return pm ? 12 : 0
  return pm ? hour + 12 : hour
}

function parseWallClock(text: string, now: number): number | null {
  const match =
    /resets?\s+(?:at\s+|on\s+)?(?:([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(?:(\d{4}),?\s+)?(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*([ap]m)\b(?:\s*\(([^)]+)\))?/i.exec(
      text
    )
  if (!match?.[4] || !match[6]) return null
  const zone = match[7]?.trim()
  const hour = to24h(Number(match[4]), match[6])
  const minute = Number(match[5] ?? '0')
  if (hour > 23 || minute > 59) return null
  const today = zonedParts(now, zone)

  if (match[1] === undefined) {
    const at = zonedTimeToUtc({ ...today, hour, minute }, zone)
    return at > now ? at : zonedTimeToUtc({ ...today, day: today.day + 1, hour, minute }, zone)
  }
  const month = MONTHS.indexOf(match[1].toLowerCase()) + 1
  if (month === 0) return null
  const day = Number(match[2])
  if (match[3] !== undefined)
    return zonedTimeToUtc({ year: Number(match[3]), month, day, hour, minute }, zone)
  const thisYear = zonedTimeToUtc({ year: today.year, month, day, hour, minute }, zone)
  // A date without a year that already passed (beyond clock skew) means next year, e.g. "Jan 2" in December.
  return thisYear >= now - DAY_MS
    ? thisYear
    : zonedTimeToUtc({ year: today.year + 1, month, day, hour, minute }, zone)
}

function parseRelative(text: string, now: number): number | null {
  const match =
    /resets?\s+in\s+(?:(\d+)\s*d(?:ays?)?\s*)?(?:(\d+)\s*h(?:ours?|rs?)?\s*)?(?:(\d+)\s*m(?:in(?:ute)?s?)?)?/i.exec(
      text
    )
  if (!match || (match[1] === undefined && match[2] === undefined && match[3] === undefined)) return null
  const days = Number(match[1] ?? '0')
  const hours = Number(match[2] ?? '0')
  const minutes = Number(match[3] ?? '0')
  return now + days * DAY_MS + hours * HOUR_MS + minutes * 60_000
}

function parseEpoch(text: string): number | null {
  const match = /\|\s*(\d{10}|\d{13})\b/.exec(text)
  if (!match?.[1]) return null
  const value = Number(match[1])
  return match[1].length === 13 ? value : value * 1000
}

function parseIso(text: string): number | null {
  const match = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})/.exec(text)
  if (!match) return null
  const ms = Date.parse(match[0])
  return Number.isNaN(ms) ? null : ms
}

/** ISO time when the limit resets, or null if the text does not say. See the module comment. */
export function parseResetAt(text: string, now: number): string | null {
  const ms = parseEpoch(text) ?? parseIso(text) ?? parseRelative(text, now) ?? parseWallClock(text, now)
  return ms === null || !Number.isFinite(ms) ? null : new Date(ms).toISOString()
}

/** ISO time from a unix timestamp in seconds (the SDK's `resetsAt`). */
export function resetAtFromUnix(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return null
  return new Date(seconds * 1000).toISOString()
}
