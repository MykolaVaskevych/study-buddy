/**
 * Bridges a callback-style streaming call to an async generator. Providers run the request with
 * an `onText` callback; deltas are queued and yielded in order, and the call's result becomes
 * the generator's return value. If the consumer stops iterating early, the call is aborted so
 * no model output is produced for nobody.
 */
export async function* pumpText<R>(
  start: (onText: (text: string) => void, signal: AbortSignal) => Promise<R>,
  outer: AbortSignal | undefined
): AsyncGenerator<{ type: 'text'; text: string }, R> {
  const local = new AbortController()
  const signal = outer === undefined ? local.signal : AbortSignal.any([outer, local.signal])
  const queue: string[] = []
  let wake: (() => void) | null = null
  let settled = false
  const done = start((text) => {
    queue.push(text)
    wake?.()
  }, signal).finally(() => {
    settled = true
    wake?.()
  })
  // Errors are rethrown by `await done` below; this only prevents an unhandled-rejection warning.
  done.catch(() => undefined)
  try {
    while (!settled || queue.length > 0) {
      const text = queue.shift()
      if (text !== undefined) yield { type: 'text', text }
      else if (!settled) await new Promise<void>((resolve) => (wake = resolve))
    }
    return await done
  } finally {
    if (!settled) local.abort()
  }
}
