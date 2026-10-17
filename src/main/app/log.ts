/**
 * Minimal logger the main-process modules depend on. Injected so tests can capture output and so a
 * file logger can replace the console later without touching callers.
 */
export interface Log {
  info(message: string): void
  warn(message: string): void
  /** `err` is printed with its stack when it is an Error. */
  error(message: string, err?: unknown): void
}

/** Console-backed logger with a fixed prefix, e.g. `[main]`. */
export function createConsoleLog(prefix: string): Log {
  return {
    info: (message) => console.info(`${prefix} ${message}`),
    warn: (message) => console.warn(`${prefix} ${message}`),
    error: (message, err) => {
      if (err === undefined) console.error(`${prefix} ${message}`)
      else console.error(`${prefix} ${message}`, err instanceof Error ? (err.stack ?? err.message) : err)
    }
  }
}
