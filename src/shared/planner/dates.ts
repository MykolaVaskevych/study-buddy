/**
 * Calendar-day arithmetic on ISO dates. Only the leading YYYY-MM-DD of a string is used, read as
 * a calendar date. The math runs on UTC day numbers, so results never depend on the host time zone.
 */

const MS_PER_DAY = 86_400_000
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})/

/** Days since 1970-01-01 of the date at the start of `iso`, or null if it is not a valid date. */
export function isoDayNumber(iso: string): number | null {
  const m = ISO_DAY.exec(iso)
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const ms = Date.UTC(y, mo - 1, d)
  const back = new Date(ms)
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null
  return Math.round(ms / MS_PER_DAY)
}

/** YYYY-MM-DD for a day number. */
export function isoDayString(day: number): string {
  return new Date(day * MS_PER_DAY).toISOString().slice(0, 10)
}

/**
 * Study days from `today` up to the day before the exam (the exam day itself is excluded). At least 1,
 * so an exam today or tomorrow still leaves today. Null if either date is invalid.
 */
export function studyDaysUntil(today: string, examDate: string): number | null {
  const from = isoDayNumber(today)
  const to = isoDayNumber(examDate)
  if (from === null || to === null) return null
  return Math.max(1, to - from)
}
