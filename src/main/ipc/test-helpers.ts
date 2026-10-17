import type { Log } from '../app/log'
import type { Handlers } from '../pipelines/types'

/**
 * Test helpers (not used by the app). `stubHandlers` fills every channel that a test does not
 * implement with a rejecting stub, so an unexpected call fails loudly instead of returning undefined.
 */
export function stubHandlers(impl: Partial<Handlers>): Handlers {
  return new Proxy(impl, {
    get(target, key) {
      if (typeof key !== 'string') return undefined
      const own: unknown = Reflect.get(target, key)
      return own ?? (() => Promise.reject(new Error(`unexpected call: ${key}`)))
    }
  }) as Handlers
}

export interface MemoryLog extends Log {
  lines: { level: 'info' | 'warn' | 'error'; message: string; err?: unknown }[]
  /** Everything logged, including error stacks, as one string (to assert secrets never appear). */
  text(): string
}

export function memoryLog(): MemoryLog {
  const lines: MemoryLog['lines'] = []
  return {
    lines,
    info: (message) => void lines.push({ level: 'info', message }),
    warn: (message) => void lines.push({ level: 'warn', message }),
    error: (message, err) => void lines.push({ level: 'error', message, err }),
    text: () =>
      lines
        .map(
          (l) =>
            `${l.message} ${l.err instanceof Error ? (l.err.stack ?? l.err.message) : String(l.err ?? '')}`
        )
        .join('\n')
  }
}
