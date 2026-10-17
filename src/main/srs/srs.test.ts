import type { Rating, SrsData } from '@shared/domain'
import { createSrs } from './index'

const DAY = 24 * 60 * 60 * 1000
const T0 = '2026-10-01T09:00:00.000Z'
const plus = (iso: string, ms: number) => new Date(new Date(iso).getTime() + ms).toISOString()
const days = (from: string, to: string) => (new Date(to).getTime() - new Date(from).getTime()) / DAY

/** Reviews each rating at its due time; returns the final state. */
function run(srs = createSrs({ fuzz: false }), ratings: Rating[], start = T0): SrsData {
  let card = srs.newCard(start)
  let now = start
  for (const r of ratings) {
    card = srs.review(card, r, now, null)
    now = card.due
  }
  return card
}

describe('createSrs', () => {
  it('a new card is due now, in state new, with zero retrievability', () => {
    const srs = createSrs()
    const card = srs.newCard(T0)
    expect(card).toMatchObject({ due: T0, state: 'new', reps: 0, lapses: 0, lastReview: null })
    expect(srs.retrievability(card, plus(T0, 5 * DAY))).toBe(0)
  })

  it('Good keeps growing the interval', () => {
    const srs = createSrs({ fuzz: false })
    let card = run(srs, [3, 3])
    expect(card.state).toBe('review')
    const intervals: number[] = []
    for (let i = 0; i < 4; i++) {
      const now = card.due
      card = srs.review(card, 3, now, null)
      intervals.push(days(now, card.due))
    }
    for (let i = 1; i < intervals.length; i++) expect(intervals[i]).toBeGreaterThan(intervals[i - 1]!)
    expect(card.reps).toBe(6)
  })

  it('Again on a review card is a lapse: relearning, lapses+1, lower stability, short interval', () => {
    const srs = createSrs({ fuzz: false })
    const before = run(srs, [3, 3, 3, 3])
    expect(before.state).toBe('review')
    const after = srs.review(before, 1, before.due, null)
    expect(after.state).toBe('relearning')
    expect(after.lapses).toBe(before.lapses + 1)
    expect(after.stability).toBeLessThan(before.stability)
    expect(days(before.due, after.due)).toBeLessThan(1)
  })

  it('retrievability starts near 1 after a review and decreases over time', () => {
    const srs = createSrs({ fuzz: false })
    const card = run(srs, [3, 3, 3])
    const reviewed = card.lastReview!
    const r = [0, 0.5, 3, 30, 300].map((d) => srs.retrievability(card, plus(reviewed, d * DAY)))
    expect(r[0]).toBeCloseTo(1, 5)
    for (let i = 1; i < r.length; i++) expect(r[i]).toBeLessThan(r[i - 1]!)
    expect(r.at(-1)).toBeGreaterThan(0)
    // At t = stability, FSRS defines R = 90 %.
    expect(srs.retrievability(card, plus(reviewed, card.stability * DAY))).toBeCloseTo(0.9, 2)
  })

  describe('deadline cap', () => {
    const srs = createSrs({ fuzz: false })
    const mature = run(srs, [3, 3, 3, 3, 3]) // long intervals by now
    const now = mature.due
    const uncapped = srs.review(mature, 3, now, null)

    it('pulls a review that would land after the exam to one day before it', () => {
      expect(days(now, uncapped.due)).toBeGreaterThan(20)
      const exam = plus(now, 10 * DAY)
      const capped = srs.review(mature, 3, now, exam)
      expect(capped.due).toBe(plus(exam, -DAY))
      expect(capped.scheduledDays).toBe(9)
      // The memory model is untouched.
      expect(capped.stability).toBe(uncapped.stability)
      expect(capped.difficulty).toBe(uncapped.difficulty)
    })

    it('never schedules sooner than a day while the exam is more than a day away', () => {
      const exam = plus(now, 1.5 * DAY)
      expect(srs.review(mature, 3, now, exam).due).toBe(plus(now, DAY))
    })

    it('leaves reviews that already land before the cap alone', () => {
      const exam = plus(now, (days(now, uncapped.due) + 2) * DAY)
      expect(srs.review(mature, 3, now, exam)).toEqual(uncapped)
    })

    it('ignores exams in the past', () => {
      expect(srs.review(mature, 3, now, plus(now, -DAY))).toEqual(uncapped)
    })

    it('crams when the exam is a day or less away', () => {
      const exam = plus(now, 12 * 60 * 60 * 1000)
      const capped = srs.review(mature, 4, now, exam)
      expect(capped.due).toBe(plus(now, 10 * 60 * 1000))
      const again = srs.review(mature, 1, now, exam)
      expect(days(now, again.due)).toBeLessThanOrEqual(10 / (24 * 60))
    })

    it('does not touch learning-state cards when the exam is further away', () => {
      const fresh = srs.newCard(T0)
      const learning = srs.review(fresh, 3, T0, plus(T0, 10 * DAY))
      expect(learning).toEqual(srs.review(fresh, 3, T0, null))
    })
  })

  it('fuzz is deterministic for the same inputs and seed', () => {
    const a = createSrs({ seed: 'x' })
    const b = createSrs({ seed: 'x' })
    const card = run(createSrs({ fuzz: false }), [3, 3, 3, 3])
    expect(a.review(card, 3, card.due, null)).toEqual(b.review(card, 3, card.due, null))
  })
})
