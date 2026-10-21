import { useState } from 'react'
import type { CramScope } from '@shared/domain'
import { useCardStats, usePrepare, useTopics } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Button, cx, Icon } from '../../components'

/** Picked chapters per file: 'all' or the chosen root topics. Files that are not ticked are absent. */
export type ScopeChoice = Map<string, 'all' | Set<string>>

/** The cram's scopes from the picker's choice, in file order; files with no chapter ticked drop out. */
export function scopesOf(choice: ScopeChoice, order: readonly string[]): CramScope[] {
  return order.flatMap((docId): CramScope[] => {
    const c = choice.get(docId)
    if (c === undefined) return []
    if (c === 'all') return [{ docId, topicIds: null }]
    return c.size > 0 ? [{ docId, topicIds: [...c] }] : []
  })
}

function FileChoice({
  docId,
  title,
  choice,
  onChange
}: {
  docId: string
  title: string
  choice: 'all' | Set<string> | undefined
  onChange: (next: 'all' | Set<string> | undefined) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const topics = useTopics(docId)
  const stats = useCardStats(docId)
  const prepare = usePrepare()
  const chapters = (topics.data ?? []).filter((t) => t.parentId === null)
  const ticked = choice !== undefined
  const has = (id: string): boolean => choice === 'all' || (choice instanceof Set && choice.has(id))
  const toggleChapter = (id: string): void => {
    const current = choice === 'all' ? new Set(chapters.map((c) => c.id)) : new Set(choice ?? [])
    if (current.has(id)) current.delete(id)
    else current.add(id)
    onChange(current.size === 0 ? undefined : current.size === chapters.length ? 'all' : current)
  }
  const cards = stats.data?.total ?? null

  return (
    <li className="flex flex-col">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-expanded={open}
          aria-label={open ? `Hide chapters of ${title}` : `Choose chapters of ${title}`}
          disabled={chapters.length === 0}
          onClick={() => setOpen((v) => !v)}
          className="inline-flex size-6 items-center justify-center rounded-sm text-faint hover:text-ink disabled:invisible"
        >
          <Icon name="chevron-down" size={14} className={cx('transition-transform', !open && '-rotate-90')} />
        </button>
        <label className="flex min-w-0 flex-1 items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ticked}
            ref={(el) => {
              if (el) el.indeterminate = choice instanceof Set
            }}
            onChange={(e) => onChange(e.target.checked ? 'all' : undefined)}
          />
          <span className="truncate font-semibold">{title}</span>
          {cards !== null ? (
            <span className={cx('tabular shrink-0 text-xs', cards === 0 ? 'text-redpen' : 'text-faint')}>
              {cards === 0 ? 'no flashcards yet' : `${cards} cards`}
            </span>
          ) : null}
        </label>
        {ticked && cards === 0 ? (
          <Button
            size="sm"
            loading={prepare.isPending}
            onClick={() =>
              prepare.mutate(
                { docId, force: true },
                { onSuccess: (r) => toast({ tone: 'ok', title: `Preparing ${title}`, body: r.message }) }
              )
            }
          >
            Make cards
          </Button>
        ) : null}
      </div>
      {open && chapters.length > 0 ? (
        <ul
          aria-label={`Chapters of ${title}`}
          className="ml-8 flex flex-col gap-1 border-l border-rule py-1 pl-3"
        >
          {chapters.map((c) => (
            <li key={c.id}>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={has(c.id)} onChange={() => toggleChapter(c.id)} />
                <span className="truncate">{c.title}</span>
              </label>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

/**
 * "What's on the test?": the course's files (weeks, lectures) with their chapters. A test on weeks
 * 5–7 ticks those files; a test on part of one file ticks its chapters.
 */
export function ScopePicker({
  files,
  choice,
  onChange
}: {
  files: { docId: string; title: string }[]
  choice: ScopeChoice
  onChange: (next: ScopeChoice) => void
}): React.JSX.Element {
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-semibold">What’s on the test?</legend>
      <p className="text-sm text-graphite">
        Tick the files (weeks, lectures) it covers, or open one to pick chapters.
      </p>
      <ul aria-label="Files and chapters" className="flex flex-col gap-1">
        {files.map((f) => (
          <FileChoice
            key={f.docId}
            docId={f.docId}
            title={f.title}
            choice={choice.get(f.docId)}
            onChange={(next) => {
              const copy: ScopeChoice = new Map(choice)
              if (next === undefined) copy.delete(f.docId)
              else copy.set(f.docId, next)
              onChange(copy)
            }}
          />
        ))}
      </ul>
    </fieldset>
  )
}
