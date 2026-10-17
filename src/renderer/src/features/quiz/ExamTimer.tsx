import { useEffect, useRef, useState } from 'react'
import { cx, Icon } from '../../components'

/** 754 → "12:34". */
export function formatClock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return `${m}:${String(s % 60).padStart(2, '0')}`
}

/** Spoken at these marks only, so the countdown doesn't chatter. */
function announcement(left: number): string {
  if (left === 300) return '5 minutes left'
  if (left === 60) return '1 minute left'
  if (left === 0) return 'Time is up. Your answers are being handed in.'
  return ''
}

interface ExamTimerProps {
  minutes: number
  onExpire: () => void
}

/** Countdown for exam mode. Turns red in the last minute; hands in when it reaches zero. */
export function ExamTimer({ minutes, onExpire }: ExamTimerProps): React.JSX.Element {
  const [left, setLeft] = useState(minutes * 60)
  const expire = useRef(onExpire)
  useEffect(() => {
    expire.current = onExpire
  })
  useEffect(() => {
    const end = Date.now() + minutes * 60_000
    const tick = window.setInterval(() => {
      const s = Math.max(0, Math.round((end - Date.now()) / 1000))
      setLeft(s)
      if (s === 0) {
        window.clearInterval(tick)
        expire.current()
      }
    }, 1000)
    return () => window.clearInterval(tick)
  }, [minutes])

  const urgent = left <= 60
  return (
    <span
      className={cx(
        'tabular inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-serif text-lg font-semibold',
        urgent ? 'bg-redpen-soft text-redpen' : 'text-ink'
      )}
    >
      <Icon name="clock" size={18} />
      <span role="timer" aria-label={`Time left ${formatClock(left)}`}>
        {formatClock(left)}
      </span>
      <span aria-live="assertive" className="sr-only">
        {announcement(left)}
      </span>
    </span>
  )
}
