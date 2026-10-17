import { useEffect, useRef } from 'react'
import { cx } from '../../components'

/** 2 → "2", 2.5 → "2.5": partial credit shows one decimal. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1)
}

/** Green from 70 %, red below 40 %, ink between. */
export function scoreTone(ratio: number): 'ok' | 'ink' | 'redpen' {
  return ratio >= 0.7 ? 'ok' : ratio < 0.4 ? 'redpen' : 'ink'
}

const toneClass = { ok: 'text-ok', ink: 'text-ink', redpen: 'text-redpen' } as const

interface ScoreProps {
  score: number
  max: number
  size?: 'md' | 'lg'
  className?: string
}

/**
 * The score written at the top of a marked test and circled in pen. The circle is drawn once
 * when the result appears (skipped with reduced motion).
 */
export function Score({ score, max, size = 'md', className }: ScoreProps): React.JSX.Element {
  const ring = useRef<SVGPathElement>(null)
  const ratio = max > 0 ? score / max : 0

  useEffect(() => {
    const path = ring.current
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (!path || reduced || typeof path.animate !== 'function') return
    path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
      duration: 700,
      delay: 120,
      easing: 'cubic-bezier(0.22, 1, 0.36, 1)',
      fill: 'backwards'
    })
  }, [])

  return (
    <span
      role="img"
      aria-label={`${formatScore(score)} out of ${max}`}
      className={cx(
        'relative inline-flex items-center justify-center',
        size === 'lg' ? 'px-9 py-4' : 'px-6 py-3',
        className
      )}
    >
      <span
        aria-hidden
        className={cx(
          'tabular font-serif leading-none font-semibold text-ink',
          size === 'lg' ? 'text-[2.75rem]' : 'text-3xl'
        )}
      >
        {formatScore(score)}
        <span className="mx-0.5 font-normal text-faint">/</span>
        {max}
      </span>
      <svg
        aria-hidden
        viewBox="0 0 120 64"
        preserveAspectRatio="none"
        className={cx(
          'pointer-events-none absolute inset-0 h-full w-full overflow-visible',
          toneClass[scoreTone(ratio)]
        )}
      >
        <path
          ref={ring}
          d="M18 12C40 2 96 2 112 18c12 14-4 38-46 41C26 62 4 48 7 30 9 18 30 8 58 5"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.25}
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
          pathLength={1}
          strokeDasharray={1}
        />
      </svg>
    </span>
  )
}
