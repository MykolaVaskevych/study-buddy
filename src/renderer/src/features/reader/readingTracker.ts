/**
 * Measures seconds spent on each page. Time only counts while the reader is active (window
 * visible, recent input). Pure apart from the injected clock, so it is unit tested.
 *
 * Flushes happen on page change, on pause, and when `tick` finds ≥ `flushEverySec` pending.
 */
export interface ReadingEntry {
  page: number
  seconds: number
}

export interface TrackerOptions {
  flushEverySec?: number
  /** Ignore slivers shorter than this (fast scrolling past a page). */
  minSeconds?: number
  /** Contract cap for one report. */
  maxSeconds?: number
}

export class ReadingTracker {
  private page: number | null = null
  private activeSince: number | null = null
  private pendingMs = 0
  private readonly flushEveryMs: number
  private readonly minMs: number
  private readonly maxSeconds: number

  constructor(
    private readonly flush: (entry: ReadingEntry) => void,
    options: TrackerOptions = {}
  ) {
    this.flushEveryMs = (options.flushEverySec ?? 15) * 1000
    this.minMs = (options.minSeconds ?? 1) * 1000
    this.maxSeconds = options.maxSeconds ?? 3600
  }

  /** Switch to a page; flushes the previous page's time. */
  setPage(page: number, now: number): void {
    if (page === this.page) return
    this.collect(now)
    this.emit()
    this.page = page
  }

  /** Window visible and the person is around. */
  resume(now: number): void {
    if (this.activeSince === null) this.activeSince = now
  }

  /** Window hidden or idle: stop the clock and report what we have. */
  pause(now: number): void {
    this.collect(now)
    this.activeSince = null
    this.emit()
  }

  /** Call periodically; flushes once enough time has accumulated. */
  tick(now: number): void {
    this.collect(now)
    if (this.pendingMs >= this.flushEveryMs) this.emit()
  }

  /** Final flush (unmount / document change). */
  stop(now: number): void {
    this.pause(now)
    this.page = null
  }

  private collect(now: number): void {
    if (this.activeSince === null) return
    this.pendingMs += Math.max(0, now - this.activeSince)
    this.activeSince = now
  }

  private emit(): void {
    const ms = this.pendingMs
    this.pendingMs = 0
    if (this.page === null || ms < this.minMs) return
    this.flush({ page: this.page, seconds: Math.min(this.maxSeconds, Math.round(ms / 1000)) })
  }
}
