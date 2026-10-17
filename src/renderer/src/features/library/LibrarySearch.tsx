import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router'
import type { DocumentSummary, SearchHit } from '@shared/domain'
import { useLibrarySearch } from '../../api/hooks'
import { cx, Icon, Kbd } from '../../components'
import { useShortcuts } from '../../app/shortcuts'
import { highlightParts } from './format'

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = window.setTimeout(() => setV(value), ms)
    return () => window.clearTimeout(t)
  }, [value, ms])
  return v
}

/** Search across every book's text; Enter or click jumps to the page. */
export function LibrarySearch({ docs }: { docs: DocumentSummary[] }): React.JSX.Element {
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const debounced = useDebounced(query, 180)
  const search = useLibrarySearch(debounced)
  const navigate = useNavigate()
  const input = useRef<HTMLInputElement>(null)
  const listId = useId()
  const titles = useMemo(() => new Map(docs.map((d) => [d.id, d.title])), [docs])
  const hits: SearchHit[] = query.trim().length >= 2 ? (search.data ?? []) : []
  const open = query.trim().length >= 2

  useShortcuts(useMemo(() => ({ '/': () => input.current?.focus() }), []))

  const go = (hit: SearchHit): void => {
    void navigate(`/book/${encodeURIComponent(hit.docId)}?page=${hit.page}`)
  }

  return (
    <div className="relative w-full max-w-2xl">
      <label className="flex h-11 items-center gap-3 rounded-lg border border-rule-strong bg-sheet px-3.5 focus-within:border-accent focus-within:outline-2 focus-within:outline-offset-0 focus-within:outline-accent/30">
        <Icon name="search" size={18} className="text-faint" />
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-label="Search your library"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={open && hits[active] ? `${listId}-${active}` : undefined}
          placeholder="Search every page, e.g. “power budget”"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') setActive((i) => Math.min(hits.length - 1, i + 1))
            else if (e.key === 'ArrowUp') setActive((i) => Math.max(0, i - 1))
            else if (e.key === 'Enter' && hits[active]) go(hits[active])
            else if (e.key === 'Escape') setQuery('')
            else return
            e.preventDefault()
          }}
          className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint [&::-webkit-search-cancel-button]:hidden"
        />
        {query ? null : <Kbd keys="/" />}
      </label>

      {open ? (
        <div className="absolute inset-x-0 top-12 z-20 max-h-[min(28rem,60vh)] overflow-y-auto rounded-lg border border-rule bg-sheet py-1 shadow-pop">
          <ul id={listId} role="listbox" aria-label="Search results">
            {hits.map((hit, i) => (
              <li
                key={`${hit.docId}:${hit.page}`}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                onPointerEnter={() => setActive(i)}
                onClick={() => go(hit)}
                className={cx('flex cursor-pointer gap-4 px-4 py-2.5', i === active && 'bg-sunken')}
              >
                <span className="tabular w-14 shrink-0 pt-0.5 text-sm font-semibold text-graphite">
                  p. {hit.page}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs text-faint">
                    {titles.get(hit.docId) ?? 'Unknown book'}
                  </span>
                  <span className="line-clamp-2 font-serif text-[0.95rem] leading-snug">
                    {highlightParts(hit.snippet, debounced).map((p, j) =>
                      p.match ? (
                        <mark key={j} className="marker-stroke bg-transparent">
                          {p.text}
                        </mark>
                      ) : (
                        <span key={j}>{p.text}</span>
                      )
                    )}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {hits.length === 0 ? (
            <p className="px-4 py-3 text-sm text-graphite">
              {search.isFetching ? 'Searching…' : `No page mentions “${query.trim()}”.`}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
