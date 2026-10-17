/** Formatting for reasons and notes. Short, human, and the same style everywhere. */

/** "2 h 15 m", "40 m", "3 h". Rounds to whole minutes. Negative or non-finite values show as "0 m". */
export function formatMinutes(minutes: number): string {
  const m = Number.isFinite(minutes) ? Math.max(0, Math.round(minutes)) : 0
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r} m`
  return r === 0 ? `${h} h` : `${h} h ${r} m`
}

/** A 0..1 share as a whole percent: "14 %". */
export function formatPercent(share: number): string {
  const x = Number.isFinite(share) ? share : 0
  return `${Math.round(x * 100)} %`
}

/** An estimated share: "~14 %", or "<1 %" when it would round to 0 but isn't 0. */
export function approxPercent(share: number): string {
  const x = Number.isFinite(share) ? share : 0
  if (x > 0 && x < 0.005) return '<1 %'
  return `~${formatPercent(x)}`
}
