import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Button } from '../../components'
import { useTour } from './tourStore'
import type { TourStep } from './tours'

export interface Rect {
  top: number
  left: number
  width: number
  height: number
}

const PAD = 6
const GAP = 12
const MARGIN = 12

/** Card position next to the target: below, above, right, left, else centred; always inside the viewport. */
export function placeCard(
  target: Rect | null,
  card: { width: number; height: number },
  viewport: { width: number; height: number }
): { top: number; left: number } {
  const clampX = (x: number): number => Math.min(Math.max(x, MARGIN), viewport.width - card.width - MARGIN)
  const clampY = (y: number): number => Math.min(Math.max(y, MARGIN), viewport.height - card.height - MARGIN)
  if (!target)
    return {
      top: clampY((viewport.height - card.height) / 2),
      left: clampX((viewport.width - card.width) / 2)
    }
  const below = target.top + target.height + PAD + GAP
  if (below + card.height <= viewport.height - MARGIN) return { top: below, left: clampX(target.left) }
  const above = target.top - PAD - GAP - card.height
  if (above >= MARGIN) return { top: above, left: clampX(target.left) }
  const right = target.left + target.width + PAD + GAP
  if (right + card.width <= viewport.width - MARGIN) return { top: clampY(target.top), left: right }
  const left = target.left - PAD - GAP - card.width
  if (left >= MARGIN) return { top: clampY(target.top), left }
  return { top: clampY((viewport.height - card.height) / 2), left: clampX((viewport.width - card.width) / 2) }
}

function findTarget(step: TourStep): HTMLElement | null {
  if (!step.target) return null
  for (const el of document.querySelectorAll<HTMLElement>(step.target)) {
    const r = el.getBoundingClientRect()
    if (r.width > 0 && r.height > 0) return el
  }
  return null
}

/** The active tour: a dimmed screen with a cut-out around the highlighted element and a step card. */
export function TourOverlay(): React.JSX.Element | null {
  const active = useTour((s) => s.active)
  const go = useTour((s) => s.go)
  const stop = useTour((s) => s.stop)
  const cardRef = useRef<HTMLDivElement>(null)
  const [rect, setRect] = useState<Rect | null>(null)
  const [pos, setPos] = useState<{ top: number; left: number }>({ top: -9999, left: -9999 })

  const steps = active?.steps ?? []
  const step = active ? steps[active.step] : undefined

  // Skip optional steps whose element is not on this screen (e.g. no books imported yet).
  useEffect(() => {
    if (!active || !step) return
    const el = findTarget(step)
    if (step.target && !el && step.optional) {
      go(1)
      return
    }
    el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' })
    cardRef.current?.focus()
  }, [active, step, go])

  // Follow the target while it moves (scrolling, resizing panes, lazy screens).
  useLayoutEffect(() => {
    if (!step) return
    let frame = 0
    const tick = (): void => {
      const el = findTarget(step)
      const r = el?.getBoundingClientRect()
      const next = r ? { top: r.top, left: r.left, width: r.width, height: r.height } : null
      setRect((prev) =>
        prev &&
        next &&
        prev.top === next.top &&
        prev.left === next.left &&
        prev.width === next.width &&
        prev.height === next.height
          ? prev
          : next
      )
      const card = cardRef.current
      if (card) {
        const p = placeCard(
          next,
          { width: card.offsetWidth, height: card.offsetHeight },
          { width: window.innerWidth, height: window.innerHeight }
        )
        setPos((prev) => (prev.top === p.top && prev.left === p.left ? prev : p))
      }
      frame = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(frame)
  }, [step])

  // Keys belong to the tour while it is open, so reader shortcuts do not fire underneath.
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') stop()
      else if (e.key === 'ArrowRight' || e.key === 'Enter') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else return
      e.preventDefault()
      e.stopPropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, go, stop])

  if (!active || !step) return null
  const last = active.step === steps.length - 1

  return (
    <div className="fixed inset-0 z-[100] print:hidden" aria-live="polite">
      {rect ? (
        <div
          aria-hidden
          className="pointer-events-none fixed rounded-lg ring-2 ring-accent transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: '0 0 0 9999px rgb(0 0 0 / 0.5)'
          }}
        />
      ) : (
        <div aria-hidden className="fixed inset-0 bg-black/50" />
      )}
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="fixed w-[22rem] max-w-[calc(100vw-1.5rem)] rounded-xl border border-rule bg-sheet p-5 shadow-2xl outline-none"
        style={{ top: pos.top, left: pos.left }}
      >
        <p className="mb-1 text-xs font-semibold tracking-wide text-graphite uppercase">
          {active.onlyNew ? 'New · ' : ''}Step {active.step + 1} of {steps.length}
        </p>
        <h2 id="tour-title" className="mb-2 font-serif text-lg font-semibold">
          {step.title}
        </h2>
        <p className="mb-4 text-[0.95rem] leading-relaxed">{step.body}</p>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={stop}>
            Skip tour
          </Button>
          <span className="flex-1" />
          {active.step > 0 && (
            <Button variant="secondary" size="sm" onClick={() => go(-1)}>
              Back
            </Button>
          )}
          <Button variant="primary" size="sm" onClick={() => go(1)}>
            {last ? 'Done' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  )
}
