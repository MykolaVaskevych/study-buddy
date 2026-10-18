import { useEffect, useRef, useState } from 'react'
import type { JobInfo } from '@shared/domain'
import { useCancelJob, useJobs, useRateLimit } from '../api/hooks'
import { cx, Icon, IconButton, Progress, Spinner } from '../components'

function JobRow({ job, onCancel }: { job: JobInfo; onCancel: (id: string) => void }): React.JSX.Element {
  return (
    <li className="flex items-center gap-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm">{job.label}</p>
        <Progress
          value={job.state === 'queued' ? null : job.progress}
          label={job.label}
          size="xs"
          tone="accent"
          className="mt-1.5"
        />
      </div>
      <IconButton
        icon="close"
        label="Cancel job"
        size="sm"
        onClick={() => onCancel(job.id)}
        tooltipSide="left"
      />
    </li>
  )
}

/**
 * Bottom status bar: what the app is doing in the background (indexing, generating) and
 * whether Claude is paused. Quiet by design; it only speaks when something is running.
 */
export function StatusBar(): React.JSX.Element {
  const { data: jobs = [] } = useJobs(null)
  const { data: rateLimit } = useRateLimit()
  const cancel = useCancelJob()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = jobs.filter((j) => j.state !== 'done' && j.state !== 'failed' && j.state !== 'cancelled')
  const first = active[0]

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent): void => {
      if (e.target instanceof Node && !ref.current?.contains(e.target)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <footer className="flex h-7 max-h-7 shrink-0 items-center gap-4 overflow-visible border-t border-rule bg-paper px-3 text-xs whitespace-nowrap text-graphite">
      <div ref={ref} className="relative flex min-w-0 items-center">
        {first ? (
          <button
            type="button"
            aria-expanded={open}
            aria-haspopup="dialog"
            onClick={() => setOpen((v) => !v)}
            className="flex min-w-0 items-center gap-2 rounded-sm px-1.5 py-0.5 hover:bg-sunken hover:text-ink"
          >
            {rateLimit ? <Icon name="pause" size={14} /> : <Spinner size={12} />}
            <span className="truncate">{first.label}</span>
            <span className="tabular shrink-0 text-faint">{Math.round(first.progress * 100)}%</span>
            {active.length > 1 ? (
              <span className="shrink-0 font-semibold">+{active.length - 1} more</span>
            ) : null}
          </button>
        ) : (
          <span className="px-1.5">No background work</span>
        )}
        {open && active.length > 0 ? (
          <div
            role="dialog"
            aria-label="Background jobs"
            className="absolute bottom-8 left-0 z-30 max-h-[60vh] w-96 overflow-y-auto rounded-lg border border-rule bg-sheet px-4 py-2 whitespace-normal text-ink shadow-pop"
          >
            <ul className="divide-y divide-rule">
              {active.map((j) => (
                <JobRow key={j.id} job={j} onCancel={(jobId) => cancel.mutate({ jobId })} />
              ))}
            </ul>
          </div>
        ) : null}
      </div>
      <span className={cx('ml-auto flex items-center gap-1.5', !rateLimit && 'hidden')}>
        <Icon name="clock" size={14} />
        Claude paused
      </span>
    </footer>
  )
}
