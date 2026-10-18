import { useEffect, useMemo } from 'react'
import { appVersion, entries } from 'virtual:whatsnew'
import { Badge, Button, Dialog } from '../../components'
import { useTour } from '../tour/tourStore'
import { groupByVersion, pendingEntries, readLastSeen, useWhatsNewDialog, writeLastSeen } from './model'

const MAX_ALL = 40

/**
 * "What's new": release notes generated from the git history at build time (build-tools/whatsnew).
 * Opens by itself once after an update; Settings can open the full history.
 */
export function WhatsNew(): React.JSX.Element | null {
  const { open, show, close } = useWhatsNewDialog()
  const existingUser = useTour.getState().seen.length > 0
  const pending = useMemo(() => pendingEntries(entries, readLastSeen(), existingUser), [existingUser])

  useEffect(() => {
    const newest = entries[0]
    if (!newest) return
    if (pending.length > 0) show('pending')
    // Nothing to tell (new user, or history rewritten): start counting from now.
    else if (readLastSeen() !== newest.hash) writeLastSeen(newest.hash)
  }, [pending, show])

  if (open === null) return null
  const list = open === 'pending' ? pending : entries.slice(0, MAX_ALL)
  const dismiss = (): void => {
    if (entries[0]) writeLastSeen(entries[0].hash)
    close()
  }

  return (
    <Dialog
      open
      onClose={dismiss}
      title="What's new"
      description={`Study Buddy ${appVersion}`}
      actions={
        <Button variant="primary" size="sm" onClick={dismiss}>
          Got it
        </Button>
      }
    >
      {list.length === 0 ? (
        <p className="text-[0.95rem]">You are up to date.</p>
      ) : (
        <div className="flex max-h-[60vh] flex-col gap-5 overflow-y-auto pr-1">
          {groupByVersion(list).map((g) => (
            <section key={g.version ?? 'unreleased'}>
              <h3 className="mb-2 text-sm font-semibold text-graphite">
                {g.version ?? 'New since the last release'}
              </h3>
              <ul className="flex flex-col gap-3">
                {[...g.items]
                  .sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'feat' ? -1 : 1))
                  .map((e) => (
                    <li key={e.hash} className="flex gap-2">
                      <Badge tone={e.kind === 'feat' ? 'accent' : 'ok'}>
                        {e.kind === 'feat' ? 'New' : 'Fixed'}
                      </Badge>
                      <div className="min-w-0">
                        <p className="font-semibold">{e.title}</p>
                        {e.detail ? <p className="text-sm text-graphite">{e.detail}</p> : null}
                      </div>
                    </li>
                  ))}
              </ul>
            </section>
          ))}
          <p className="text-sm text-graphite">
            Screens with new features show a short tour of just the new parts.
          </p>
        </div>
      )}
    </Dialog>
  )
}
