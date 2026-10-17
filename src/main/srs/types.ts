import type { IsoDate, Rating, SrsData } from '@shared/domain'

/**
 * Spaced repetition contract (owner: data work package). Wraps ts-fsrs.
 * Deadline-aware: with an exam date, intervals are capped so every card is seen again
 * shortly before the exam instead of being scheduled after it.
 */
export interface Srs {
  newCard(now: IsoDate): SrsData
  review(srs: SrsData, rating: Rating, now: IsoDate, examDate: IsoDate | null): SrsData
  /** Probability of recall at a given moment (0..1). New cards return 0. */
  retrievability(srs: SrsData, at: IsoDate): number
}
