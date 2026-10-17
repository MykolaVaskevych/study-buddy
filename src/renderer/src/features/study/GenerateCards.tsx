import { useState } from 'react'
import type { Scope } from '@shared/domain'
import { useGenerateCards, useJob } from '../../api/hooks'
import { Button, Icon, Progress } from '../../components'

interface GenerateCardsProps {
  scope: Scope
  /** "page 40", "Dispersion", "pages 40–44". */
  scopeLabel: string
}

function JobLine({ jobId, onDone }: { jobId: string; onDone: () => void }): React.JSX.Element | null {
  const job = useJob(jobId).data
  if (!job || job.state === 'queued' || job.state === 'running' || job.state === 'paused') {
    const value = job && job.state !== 'queued' ? job.progress : null
    const label =
      job?.state === 'paused' ? 'Paused until Claude is available again' : (job?.label ?? 'Starting…')
    return (
      <div role="status" className="flex flex-col gap-1.5">
        <p className="flex items-center justify-between gap-3 text-sm text-graphite">
          <span className="truncate">{label}</span>
          {value !== null ? <span className="tabular shrink-0">{Math.round(value * 100)}%</span> : null}
        </p>
        <Progress value={value} label="Writing flashcards" tone="accent" size="xs" />
      </div>
    )
  }
  if (job.state === 'done') {
    return (
      <p role="status" className="flex items-center gap-2 text-sm text-ok">
        <Icon name="check" size={16} /> New cards added below.
        <button type="button" onClick={onDone} className="ml-auto text-graphite hover:text-ink">
          Dismiss
        </button>
      </p>
    )
  }
  return (
    <p role="alert" className="flex items-center gap-2 text-sm text-redpen">
      <Icon name="alert" size={16} />
      {job.state === 'cancelled'
        ? 'Card writing was cancelled.'
        : `Card writing failed${job.error ? `: ${job.error}` : '.'}`}
      <button type="button" onClick={onDone} className="ml-auto text-graphite hover:text-ink">
        Dismiss
      </button>
    </p>
  )
}

/** "Make cards" for the current scope: the essentials deck or the full deck, with job progress. */
export function GenerateCards({ scope, scopeLabel }: GenerateCardsProps): React.JSX.Element {
  const generate = useGenerateCards()
  const [jobId, setJobId] = useState<string | null>(null)
  const run = (essentialsOnly: boolean): void =>
    generate.mutate({ scope, essentialsOnly, count: null }, { onSuccess: ({ jobId: id }) => setJobId(id) })

  return (
    <div className="flex flex-col gap-3 rounded-lg bg-sunken px-4 py-3.5">
      <p className="text-sm text-graphite">
        Make cards for <span className="font-semibold text-ink">{scopeLabel}</span>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="primary"
          icon="sparkle"
          loading={generate.isPending}
          onClick={() => run(true)}
        >
          Essentials
        </Button>
        <Button size="sm" disabled={generate.isPending} onClick={() => run(false)}>
          Full deck
        </Button>
        <span className="text-xs text-graphite">Essentials: the few cards that carry most marks.</span>
      </div>
      {jobId ? <JobLine key={jobId} jobId={jobId} onDone={() => setJobId(null)} /> : null}
    </div>
  )
}
