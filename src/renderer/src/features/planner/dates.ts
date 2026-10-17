import { isoDayNumber, isoDayString } from '@shared/planner/dates'

/**
 * Calendar days for the planner screen. The planner works on YYYY-MM-DD days; "today" is the
 * student's local day, not the UTC one, so a plan made at 23:30 still starts today.
 */

/** The local calendar day of `d` as YYYY-MM-DD. */
export function localDay(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${d.getFullYear()}-${mm}-${dd}`
}

/** `day` moved by `n` calendar days. Invalid input comes back unchanged. */
export function addDays(day: string, n: number): string {
  const num = isoDayNumber(day)
  return num === null ? day : isoDayString(num + n)
}

/** Whole days from `from` to `to` (negative when `to` is earlier), or null for invalid days. */
export function daysBetween(from: string, to: string): number | null {
  const a = isoDayNumber(from)
  const b = isoDayNumber(to)
  return a === null || b === null ? null : b - a
}

/**
 * A stored date as a local day. Plain YYYY-MM-DD values are already days; timestamps (such as a
 * document's exam date) are read in local time. Null for missing or unreadable values.
 */
export function toLocalDay(value: string | null): string | null {
  if (!value) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return isoDayNumber(value) === null ? null : value
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : localDay(d)
}

/** "Sat 17 Oct" in the user's locale. The day is read as a calendar day, never shifted by time zones. */
export function formatDay(day: string): string {
  const num = isoDayNumber(day)
  if (num === null) return day
  return new Date(num * 86_400_000).toLocaleDateString([], {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  })
}
