const DAY = 86_400_000

/** Whole calendar days from `now` to `iso` in local time (negative = past). */
export function daysUntil(iso: string, now: Date): number {
  const target = new Date(iso)
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const b = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime()
  return Math.round((b - a) / DAY)
}

export type Urgency = 'calm' | 'soon' | 'urgent' | 'past'

export interface Countdown {
  text: string
  urgency: Urgency
}

/** "Exam in 9 days", with urgency for colouring: ≤3 days urgent, ≤7 soon. */
export function examCountdown(examDate: string | null, now: Date): Countdown | null {
  if (!examDate) return null
  const d = daysUntil(examDate, now)
  if (d < 0) return { text: 'Exam passed', urgency: 'past' }
  if (d === 0) return { text: 'Exam today', urgency: 'urgent' }
  if (d === 1) return { text: 'Exam tomorrow', urgency: 'urgent' }
  return { text: `Exam in ${d} days`, urgency: d <= 3 ? 'urgent' : d <= 7 ? 'soon' : 'calm' }
}

/** "today", "yesterday", "3 days ago", "on 12 Mar". */
export function relativeDay(iso: string, now: Date): string {
  const d = -daysUntil(iso, now)
  if (d <= 0) return 'today'
  if (d === 1) return 'yesterday'
  if (d < 14) return `${d} days ago`
  return `on ${new Date(iso).toLocaleDateString([], { day: 'numeric', month: 'short' })}`
}

/** Stable spine colour (1..6) per book so a course keeps its colour everywhere. */
export function spineIndex(id: string): number {
  let h = 0
  for (const ch of id) h = (h * 31 + (ch.codePointAt(0) ?? 0)) >>> 0
  return (h % 6) + 1
}

/** Splits a snippet into plain and matched parts for highlighting search terms. */
export function highlightParts(text: string, query: string): { text: string; match: boolean }[] {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  if (terms.length === 0) return [{ text, match: false }]
  const split = new RegExp(`(${terms.join('|')})`, 'gi')
  const whole = new RegExp(`^(?:${terms.join('|')})$`, 'i')
  return text
    .split(split)
    .filter((part) => part.length > 0)
    .map((part) => ({ text: part, match: whole.test(part) }))
}
