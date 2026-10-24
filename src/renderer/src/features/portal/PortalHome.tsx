import type { PortalWatch } from '@shared/domain'
import { useCourses, usePortalWatches, usePortalUnwatch, usePortalFindings } from '../../api/hooks'
import { useState } from 'react'
import { Button, cx, Icon, IconButton } from '../../components'
import { fieldClass } from '../study/form'

export interface SavedPortal {
  name: string
  url: string
}

/** Common portals: clicking one adds it to the list (it does not open anything by itself). */
export const SUGGESTIONS: SavedPortal[] = [
  { name: 'Brightspace (UL)', url: 'https://learn.ul.ie/' },
  { name: 'Sulis (UL)', url: 'https://sulis.ul.ie/' },
  { name: 'Blackboard', url: 'https://blackboard.com/' },
  { name: 'Moodle', url: 'https://moodle.org/' },
  { name: 'Canvas', url: 'https://canvas.instructure.com/' }
]

/** "learn.ul.ie" → "https://learn.ul.ie/"; null when it is not a web address. */
export function portalAddress(input: string): string | null {
  const text = input.trim()
  if (text === '' || /\s/.test(text)) return null
  try {
    const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function AddPortal({
  onAdd,
  onCancel
}: {
  onAdd: (p: SavedPortal) => void
  onCancel: () => void
}): React.JSX.Element {
  const [address, setAddress] = useState('')
  const [name, setName] = useState('')
  const url = portalAddress(address)
  return (
    <form
      aria-label="Add a portal"
      className="flex flex-wrap items-end gap-2 rounded-md border border-rule bg-paper p-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (url) onAdd({ name: name.trim() || hostOf(url), url })
      }}
    >
      <label className="flex min-w-56 flex-1 flex-col gap-1 text-sm">
        Address
        <input
          autoFocus
          value={address}
          placeholder="e.g. learn.ul.ie"
          onChange={(e) => setAddress(e.target.value)}
          className={cx(fieldClass, 'h-8')}
        />
      </label>
      <label className="flex min-w-40 flex-col gap-1 text-sm">
        Name (optional)
        <input
          value={name}
          placeholder={url ? hostOf(url) : 'Brightspace'}
          onChange={(e) => setName(e.target.value)}
          className={cx(fieldClass, 'h-8')}
        />
      </label>
      <Button type="submit" variant="primary" disabled={!url}>
        Add
      </Button>
      <Button type="button" variant="ghost" onClick={onCancel}>
        Cancel
      </Button>
    </form>
  )
}

/**
 * The portal's home: the student's portals, a way to add more, and the page they were on. Nothing
 * opens unless they click a portal, so a stray click on a suggestion only adds it to the list.
 */
export function PortalHome({
  portals,
  current,
  onOpen,
  onContinue,
  onChange,
  onOpenWatch
}: {
  portals: SavedPortal[]
  onOpenWatch: (watch: PortalWatch) => void
  /** The page the portal browser still has open, if any. */
  current: { url: string; title: string } | null
  onOpen: (url: string) => void
  onContinue: () => void
  onChange: (portals: SavedPortal[]) => void
}): React.JSX.Element {
  const [adding, setAdding] = useState(false)
  const watches = usePortalWatches()
  const unwatch = usePortalUnwatch()
  const findings = usePortalFindings()
  const courses = useCourses()
  const has = (url: string): boolean => portals.some((p) => p.url === url)
  const suggestions = SUGGESTIONS.filter((s) => !has(s.url))
  const add = (p: SavedPortal): void => {
    if (!has(p.url)) onChange([...portals, p])
    setAdding(false)
  }

  return (
    <section aria-label="Portal home" className="mx-auto flex max-w-2xl flex-col gap-6 px-8 py-10">
      <div className="flex flex-col gap-2">
        <h1 className="font-serif text-2xl font-semibold">Your study portals</h1>
        <p className="text-md">
          Open your university’s portal and sign in as usual. Every PDF, PowerPoint or Word file you download
          goes straight into the course you pick above. Your password stays with the portal; Study Buddy never
          sees it.
        </p>
      </div>

      {current ? (
        <Button variant="primary" className="self-start" onClick={onContinue}>
          <Icon name="chevron-right" size={16} />
          Continue: {current.title || hostOf(current.url)}
        </Button>
      ) : null}

      <div className="flex flex-col gap-2">
        {portals.length > 0 ? (
          <ul aria-label="Your portals" className="flex flex-col gap-1">
            {portals.map((p) => (
              <li key={p.url} className="group flex items-center gap-2 rounded-md hover:bg-sunken">
                <button
                  type="button"
                  onClick={() => onOpen(p.url)}
                  className="flex min-w-0 flex-1 items-baseline gap-2 px-3 py-2 text-left"
                >
                  <span className="truncate font-semibold">{p.name}</span>
                  <span className="truncate text-sm text-faint">{hostOf(p.url)}</span>
                </button>
                <IconButton
                  icon="close"
                  size="sm"
                  label={`Remove ${p.name}`}
                  onClick={() => onChange(portals.filter((x) => x.url !== p.url))}
                  className="mr-1 opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                />
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-graphite">No portals yet. Add yours, or pick one below.</p>
        )}
        {adding ? (
          <AddPortal onAdd={add} onCancel={() => setAdding(false)} />
        ) : (
          <Button className="self-start" onClick={() => setAdding(true)}>
            <Icon name="plus" size={16} />
            Add portal
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="font-semibold">Watched pages</h2>
        <p className="text-sm text-graphite">
          Choose a course and use the flag on a page to watch it. Checks run after startup and every six hours
          while Study Buddy is open.
        </p>
        {watches.isError ? <p className="text-sm text-redpen">{watches.error.message}</p> : null}
        {watches.data?.length === 0 ? <p className="text-sm text-faint">No watched pages yet.</p> : null}
        <ul aria-label="Watched pages" className="flex flex-col gap-3">
          {(watches.data ?? []).map((watch) => (
            <li key={watch.id} className="rounded-md border border-rule p-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-semibold"
                  onClick={() => onOpenWatch(watch)}
                >
                  {watch.title || watch.url}
                </button>
                <IconButton
                  icon="close"
                  label={`Stop watching ${watch.title || watch.url}`}
                  disabled={unwatch.isPending}
                  onClick={() => unwatch.mutate({ watchId: watch.id })}
                />
              </div>
              <p className="text-sm text-graphite">
                {courses.data?.find((course) => course.id === watch.courseId)?.name} ·{' '}
                {watch.checkedAt
                  ? `Checked ${new Date(watch.checkedAt).toLocaleString()}`
                  : 'Awaiting first check'}
              </p>
              {findings.data
                .filter((finding) => finding.watchId === watch.id)
                .slice(0, 3)
                .map((finding, index) => (
                  <div key={index} className="mt-2 text-sm">
                    <p className="font-semibold">
                      {finding.items.length} new {finding.items.length === 1 ? 'file' : 'files'}
                    </p>
                    <ul>
                      {finding.items.map((item) => (
                        <li key={item.href}>{item.label || item.href}</li>
                      ))}
                    </ul>
                  </div>
                ))}
            </li>
          ))}
        </ul>
        <p className="text-xs text-faint">
          Newest findings from this app session appear here. The first successful check records existing files
          quietly.
        </p>
      </div>

      {suggestions.length > 0 ? (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-semibold text-graphite">Suggestions</h2>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((s) => (
              <button
                key={s.url}
                type="button"
                aria-label={`Add ${s.name}`}
                onClick={() => add(s)}
                className="flex items-center gap-1 rounded-full border border-rule bg-paper px-3 py-1 text-sm hover:bg-sunken"
              >
                <Icon name="plus" size={12} />
                {s.name}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  )
}
