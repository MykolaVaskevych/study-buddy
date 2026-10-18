import { BookmarkButton } from './Bookmarks'
import { useState } from 'react'
import { Link } from 'react-router'
import { useUiStore } from '../../app/uiStore'
import { cx, Icon, IconButton, Tooltip } from '../../components'
import { formatZoom } from './zoom'

interface Props {
  docId: string
  title: string
  page: number
  numPages: number | null
  zoomFactor: number
  fitMode: boolean
  onJump: (page: number) => void
  onZoom: (dir: 1 | -1) => void
  onFit: () => void
}

/** Page box: shows the current page; type a number and press Enter to jump. */
function PageBox({ page, numPages, onJump }: Pick<Props, 'page' | 'numPages' | 'onJump'>): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const commit = (): void => {
    const n = Number(draft)
    if (draft !== null && Number.isInteger(n) && n >= 1) onJump(numPages ? Math.min(n, numPages) : n)
    setDraft(null)
  }
  return (
    <span className="tabular flex items-center gap-1.5 text-sm text-graphite">
      <input
        aria-label="Page number"
        inputMode="numeric"
        value={draft ?? String(page)}
        onFocus={(e) => {
          setDraft(String(page))
          e.currentTarget.select()
        }}
        onChange={(e) => setDraft(e.target.value.replace(/\D/g, ''))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            commit()
            e.currentTarget.blur()
          } else if (e.key === 'Escape') {
            setDraft(null)
            e.currentTarget.blur()
          }
        }}
        className="h-7 w-12 rounded-sm border border-rule bg-sheet text-center text-ink outline-none focus:border-accent"
      />
      <span>of {numPages ?? '…'}</span>
    </span>
  )
}

export function ReaderToolbar({
  docId,
  title,
  page,
  numPages,
  zoomFactor,
  fitMode,
  onJump,
  onZoom,
  onFit
}: Props): React.JSX.Element {
  const panes = useUiStore((s) => s.panes)
  const toggle = useUiStore((s) => s.togglePane)
  return (
    <div className="flex h-11 shrink-0 items-center gap-2 border-b border-rule bg-paper px-2">
      <IconButton
        icon="panel-left"
        label="Course map"
        shortcut="["
        pressed={panes.left.open}
        onClick={() => toggle('left')}
      />
      <Tooltip label="Back to library" shortcut="Mod+1">
        <Link
          to="/"
          aria-label="Back to library"
          className="inline-flex size-8 items-center justify-center rounded-md text-graphite hover:bg-sunken hover:text-ink"
        >
          <Icon name="arrow-left" size={18} />
        </Link>
      </Tooltip>
      <h1 className="min-w-0 flex-1 truncate font-serif text-[0.95rem] font-semibold" title={title}>
        {title}
      </h1>

      <div className="flex items-center gap-0.5">
        <IconButton
          icon="chevron-left"
          label="Previous page"
          shortcut="k"
          disabled={page <= 1}
          onClick={() => onJump(page - 1)}
        />
        <PageBox page={page} numPages={numPages} onJump={onJump} />
        <IconButton
          icon="chevron-right"
          label="Next page"
          shortcut="j"
          disabled={numPages !== null && page >= numPages}
          onClick={() => onJump(page + 1)}
        />
      </div>

      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />

      <div className="flex items-center gap-0.5">
        <IconButton icon="zoom-out" label="Zoom out" shortcut="Mod+-" onClick={() => onZoom(-1)} />
        <span className="tabular w-12 text-center text-sm text-graphite" aria-live="polite">
          {formatZoom(zoomFactor)}
        </span>
        <IconButton icon="zoom-in" label="Zoom in" shortcut="Mod+=" onClick={() => onZoom(1)} />
        <IconButton
          icon="fit-width"
          label="Fit width"
          shortcut="Mod+0"
          pressed={fitMode}
          onClick={onFit}
          className={cx(fitMode && 'text-accent')}
        />
      </div>

      <BookmarkButton docId={docId} page={page} />

      <span aria-hidden className="mx-1 h-5 w-px bg-rule" />

      <nav data-tour="study-tools" aria-label="Study tools" className="flex items-center gap-0.5">
        {(
          [
            { to: `/book/${docId}/overview`, icon: 'sparkle', label: 'Overview: AI status & progress' },
            { to: `/book/${docId}/studybook`, icon: 'book', label: 'Study book' },
            { to: `/book/${docId}/quiz`, icon: 'target', label: 'Quiz' },
            { to: `/book/${docId}/plan`, icon: 'planner', label: 'Exam plan' },
            { to: `/book/${docId}/sheet`, icon: 'notes', label: 'Cheat sheet' }
          ] as const
        ).map((l) => (
          <Tooltip key={l.to} label={l.label}>
            <Link
              to={l.to}
              aria-label={l.label}
              className="inline-flex size-8 items-center justify-center rounded-md text-graphite hover:bg-sunken hover:text-ink"
            >
              <Icon name={l.icon} size={18} />
            </Link>
          </Tooltip>
        ))}
      </nav>

      <IconButton
        icon="panel-right"
        label="Study panel"
        shortcut="]"
        pressed={panes.right.open}
        onClick={() => toggle('right')}
      />
    </div>
  )
}
