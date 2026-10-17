import {
  createEmptyCard,
  fsrs,
  generatorParameters,
  State,
  StrategyMode,
  type Card as FsrsCard,
  type Grade
} from 'ts-fsrs'
import type { IsoDate, Rating, SrsData, SrsState } from '@shared/domain'
import type { Srs } from './types'

export type { Srs } from './types'

const DAY_MS = 24 * 60 * 60 * 1000
const MINUTE_MS = 60 * 1000

export interface SrsOptions {
  /** Target recall probability at the due date (FSRS default 0.9). */
  requestRetention?: number
  /** Longest interval in days. */
  maximumInterval?: number
  /**
   * Spread review intervals a little so cards learned together don't all fall due on the same day.
   * Deterministic: the fuzz RNG is seeded from the review time and card state (plus `seed`), so the
   * same inputs always schedule the same due date. Default true.
   */
  fuzz?: boolean
  /** Extra seed mixed into the fuzz RNG (tests, or per-install variation). */
  seed?: string
  /** Re-show interval when the exam is a day or less away ("cramming"). Default 10 minutes. */
  crammingIntervalMinutes?: number
}

const toState: Record<State, SrsState> = {
  [State.New]: 'new',
  [State.Learning]: 'learning',
  [State.Review]: 'review',
  [State.Relearning]: 'relearning'
}
const fromState: Record<SrsState, State> = {
  new: State.New,
  learning: State.Learning,
  review: State.Review,
  relearning: State.Relearning
}

function toFsrs(srs: SrsData): FsrsCard {
  return {
    due: new Date(srs.due),
    stability: srs.stability,
    difficulty: srs.difficulty,
    elapsed_days: srs.elapsedDays,
    scheduled_days: srs.scheduledDays,
    learning_steps: srs.learningSteps,
    reps: srs.reps,
    lapses: srs.lapses,
    state: fromState[srs.state],
    ...(srs.lastReview !== null ? { last_review: new Date(srs.lastReview) } : {})
  }
}

function fromFsrs(card: FsrsCard): SrsData {
  return {
    due: card.due.toISOString(),
    stability: card.stability,
    difficulty: card.difficulty,
    reps: card.reps,
    lapses: card.lapses,
    state: toState[card.state],
    lastReview: card.last_review ? card.last_review.toISOString() : null,
    elapsedDays: card.elapsed_days,
    scheduledDays: card.scheduled_days,
    learningSteps: card.learning_steps
  }
}

/**
 * Deadline-aware FSRS (ts-fsrs v5). FSRS optimises long-term retention, which is wrong for a student
 * with an exam: a 40-day interval that lands after the exam means the card is never seen again
 * before it. So, with an exam date in the future:
 * - exam more than a day away: a review-state card due after `max(now + 1 day, exam - 1 day)` is
 *   pulled forward to that time, i.e. seen again at least a day before the exam when possible;
 * - exam a day or less away: every card comes back within `crammingIntervalMinutes`.
 * Stability and difficulty stay as FSRS computed them; FSRS handles early reviews correctly, so the
 * cap only changes *when* the card is shown, not the memory model.
 */
export function createSrs(opts: SrsOptions = {}): Srs {
  const scheduler = fsrs(
    generatorParameters({
      enable_fuzz: opts.fuzz ?? true,
      ...(opts.requestRetention !== undefined ? { request_retention: opts.requestRetention } : {}),
      ...(opts.maximumInterval !== undefined ? { maximum_interval: opts.maximumInterval } : {})
    })
  )
  const extraSeed = opts.seed
  if (extraSeed !== undefined) {
    // Same inputs as ts-fsrs' default seed strategy, plus the caller's seed.
    scheduler.useStrategy(StrategyMode.SEED, function () {
      return `${extraSeed}_${this.review_time.getTime()}_${this.current.reps}_${this.current.difficulty * this.current.stability}`
    })
  }
  const crammingMs = (opts.crammingIntervalMinutes ?? 10) * MINUTE_MS

  return {
    newCard(now: IsoDate): SrsData {
      return fromFsrs(createEmptyCard(new Date(now)))
    },

    review(srs, rating: Rating, now, examDate) {
      const at = new Date(now)
      const next = fromFsrs(scheduler.next(toFsrs(srs), at, rating satisfies Grade).card)
      return examDate === null ? next : capToExam(next, at, new Date(examDate), crammingMs)
    },

    retrievability(srs, at) {
      if (srs.state === 'new' || srs.lastReview === null || srs.stability <= 0) return 0
      // Fractional days: ts-fsrs' own get_retrievability floors to whole days, which would make
      // recall look flat within a day.
      const elapsedDays = Math.max(0, (new Date(at).getTime() - new Date(srs.lastReview).getTime()) / DAY_MS)
      return scheduler.forgetting_curve(elapsedDays, srs.stability)
    }
  }
}

function capToExam(srs: SrsData, now: Date, exam: Date, crammingMs: number): SrsData {
  const nowMs = now.getTime()
  const examMs = exam.getTime()
  const dueMs = new Date(srs.due).getTime()
  if (Number.isNaN(examMs) || examMs <= nowMs) return srs

  const withDue = (ms: number): SrsData => ({
    ...srs,
    due: new Date(ms).toISOString(),
    scheduledDays: Math.max(0, Math.round((ms - nowMs) / DAY_MS))
  })

  if (examMs - nowMs <= DAY_MS) return dueMs > nowMs + crammingMs ? withDue(nowMs + crammingMs) : srs
  if (srs.state !== 'review') return srs
  const cap = Math.max(nowMs + DAY_MS, examMs - DAY_MS)
  return dueMs > cap ? withDue(cap) : srs
}
