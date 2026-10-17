import { useEffect, useState } from 'react'

/** The value once it has stopped changing for `ms` (scrolling through pages fetches only where you stop). */
export function useSettledValue<T>(value: T, ms = 200): T {
  const [settled, setSettled] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setSettled(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return settled
}
