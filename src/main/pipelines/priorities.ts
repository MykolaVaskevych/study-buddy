import type { JobState } from '@shared/domain'

/** Job priorities (higher runs first). What the user is looking at always beats background work. */
export const PRIORITY = {
  /** The index pass over a whole document. */
  bulkIndex: 0,
  /** Topic map after indexing: needed by the planner, but nobody waits on it. */
  topicMap: 10,
  /** Page check prefetched while the user reads. */
  prefetch: 50,
  /** Generation the user asked for and watches in the job list (flashcards, topic map rebuild). */
  requested: 80,
  /** Generation a request is waiting on (quiz questions). */
  awaited: 90,
  /** The reader's page: its index chunk and its page check. */
  focus: 100
} as const

/** States with work still ahead. */
export const ACTIVE_JOB_STATES: ReadonlySet<JobState> = new Set(['queued', 'running', 'paused'])
export const TERMINAL_JOB_STATES: ReadonlySet<JobState> = new Set(['done', 'failed', 'cancelled'])

/** Enough to see every job of one document; JobRepo.list needs a limit. */
export const JOB_SCAN_LIMIT = 10_000
