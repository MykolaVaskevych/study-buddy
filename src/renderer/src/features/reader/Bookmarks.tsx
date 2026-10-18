import { useCallback } from 'react'
import { useAnnotations, useDeleteAnnotation, useSaveAnnotation } from '../../api/hooks'
import { Icon, IconButton, cx } from '../../components'

/** Bookmark state for the current page plus a toggle (button and the "b" key share it). */
export function useBookmarkToggle(docId: string, page: number): { bookmarked: boolean; toggle: () => void } {
  const annotations = useAnnotations(docId)
  const save = useSaveAnnotation()
  const remove = useDeleteAnnotation()
  const bookmarked = (annotations.data ?? []).some((a) => a.kind === 'bookmark' && a.page === page)
  const toggle = useCallback(() => {
    if (bookmarked) remove.mutate({ docId, page, kind: 'bookmark' })
    else save.mutate({ docId, page, kind: 'bookmark', text: '' })
  }, [bookmarked, docId, page, remove, save])
  return { bookmarked, toggle }
}

export function BookmarkButton({ docId, page }: { docId: string; page: number }): React.JSX.Element {
  const { bookmarked, toggle } = useBookmarkToggle(docId, page)
  return (
    <span data-tour="bookmark">
      <IconButton
        icon="bookmark"
        label={bookmarked ? `Remove bookmark on page ${page}` : `Bookmark page ${page}`}
        shortcut="b"
        pressed={bookmarked}
        onClick={toggle}
        className={cx(bookmarked && 'text-accent')}
      />
    </span>
  )
}

/** Bookmarked and annotated pages, above the course map. Click to jump. */
export function BookmarkList({
  docId,
  page,
  onJump
}: {
  docId: string
  page: number
  onJump: (page: number) => void
}): React.JSX.Element | null {
  const annotations = useAnnotations(docId)
  const items = annotations.data ?? []
  const pages = [...new Set(items.map((a) => a.page))].sort((a, b) => a - b)
  if (pages.length === 0) return null
  return (
    <section aria-label="Bookmarks and notes" className="border-b border-rule px-2 pb-2">
      <h2 className="flex h-9 items-center px-2 text-sm font-semibold text-graphite">Bookmarks & notes</h2>
      <ul className="flex max-h-48 flex-col overflow-y-auto">
        {pages.map((p) => {
          const note = items.find((a) => a.page === p && a.kind === 'note')
          const marked = items.some((a) => a.page === p && a.kind === 'bookmark')
          return (
            <li key={p}>
              <button
                type="button"
                onClick={() => onJump(p)}
                className={cx(
                  'flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-sunken',
                  p === page && 'bg-sunken font-semibold'
                )}
              >
                <Icon
                  name={marked ? 'bookmark' : 'pencil'}
                  size={14}
                  className="mt-0.5 shrink-0 text-accent"
                />
                <span className="tabular shrink-0 text-graphite">p. {p}</span>
                {note?.text ? <span className="min-w-0 truncate">{note.text}</span> : null}
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
