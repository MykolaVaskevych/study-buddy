import { useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { JobInfo } from '@shared/domain'
import { useCancelJob, useJobs, useRateLimit, useSettings, useUpdateSettings } from '../api/hooks'
import { cx, Icon, IconButton, Progress, Spinner, useDismiss } from '../components'
import { notReady, providerLabel, PROVIDERS } from '../features/settings/providers'

/** Which AI is in use, switchable in one click (subscription, API key, local model). */
function ProviderSwitch(): React.JSX.Element | null {
  const { data: settings } = useSettings()
  const update = useUpdateSettings()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => setOpen(false))
  if (!settings) return null
  return (
    <div ref={ref} data-tour="provider-switch" className="relative flex items-center">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-sm px-1.5 py-0.5 hover:bg-sunken hover:text-ink"
      >
        <Icon name="sparkle" size={12} />
        {providerLabel(settings)}
        <Icon name="chevron-down" size={12} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="AI in use"
          className="absolute right-0 bottom-8 z-30 w-72 rounded-lg border border-rule bg-sheet p-1 whitespace-normal text-ink shadow-pop"
        >
          {PROVIDERS.map((p) => {
            const blocked = notReady(p.id, settings)
            const current = settings.provider === p.id
            return (
              <button
                key={p.id}
                type="button"
                role="menuitemradio"
                aria-checked={current}
                disabled={blocked !== null && !current}
                onClick={() => {
                  if (!current) update.mutate({ provider: p.id })
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left text-sm hover:bg-sunken disabled:opacity-60 disabled:hover:bg-transparent"
              >
                <span className="mt-0.5 w-4 shrink-0">
                  {current ? <Icon name="check" size={14} /> : null}
                </span>
                <span className="flex flex-col">
                  <span className="font-medium">
                    {p.id === 'openai-compatible' ? providerLabel({ ...settings, provider: p.id }) : p.title}
                  </span>
                  {blocked && !current ? <span className="text-xs text-graphite">{blocked}</span> : null}
                </span>
              </button>
            )
          })}
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false)
              void navigate('/settings')
            }}
            className="mt-1 w-full rounded-md border-t border-rule px-2.5 py-2 text-left text-sm text-graphite hover:bg-sunken hover:text-ink"
          >
            Connection settings…
          </button>
        </div>
      ) : null}
    </div>
  )
}

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

  useDismiss(open, ref, () => setOpen(false))

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
      <span className="ml-auto flex items-center gap-3">
        <span className={cx('flex items-center gap-1.5', !rateLimit && 'hidden')}>
          <Icon name="clock" size={14} />
          AI paused
        </span>
        <ProviderSwitch />
      </span>
    </footer>
  )
}
