/** Calendar helpers. "Today" for the planner and the schedule is the user's LOCAL calendar day. */

export const DAY_MS = 24 * 60 * 60 * 1000

/** YYYY-MM-DD of the local calendar day containing `at`. */
export function localDate(at: Date): string {
  const y = String(at.getFullYear()).padStart(4, '0')
  const m = String(at.getMonth() + 1).padStart(2, '0')
  const d = String(at.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}
