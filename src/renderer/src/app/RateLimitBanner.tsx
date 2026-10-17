import { useEffect, useState } from 'react'
import { useRateLimit } from '../api/hooks'
import { Icon } from '../components'

/** "14:30" in the user's locale. Exported for tests. */
export function formatResetTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** Shown while Claude's usage limit is hit; hides itself once the reset time has passed. */
export function RateLimitBanner(): React.JSX.Element | null {
  const { data: info } = useRateLimit()
  const [expiredAt, setExpiredAt] = useState<string | null>(null)
  const resetAt = info?.resetAt ?? null

  useEffect(() => {
    if (!resetAt) return
    const ms = Math.max(0, new Date(resetAt).getTime() - Date.now())
    const t = window.setTimeout(() => setExpiredAt(resetAt), ms)
    return () => window.clearTimeout(t)
  }, [resetAt])

  if (!info || (resetAt !== null && expiredAt === resetAt)) return null
  return (
    <div
      role="status"
      className="flex items-center gap-3 border-b border-rule bg-marker-soft px-6 py-2 text-ink"
    >
      <Icon name="clock" size={18} />
      <p className="text-sm">
        <span className="font-semibold">
          Claude usage limit reached{info.resetAt ? `, resumes at ${formatResetTime(info.resetAt)}` : ''}.
        </span>{' '}
        <span className="text-graphite">Background work is paused. Reading and reviewing still work.</span>
      </p>
    </div>
  )
}
