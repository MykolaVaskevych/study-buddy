import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router'
import {
  useCourses,
  usePortalBounds,
  usePortalClose,
  usePortalCourse,
  usePortalDownloads,
  usePortalGo,
  usePortalNavigate,
  usePortalOpen,
  usePortalState,
  useSettings,
  useUpdateSettings
} from '../../api/hooks'
import { cx, Icon, IconButton } from '../../components'
import { fieldClass } from '../study/form'
import { PortalHome, type SavedPortal } from './PortalHome'
import { useAutoTour } from '../tour/useAutoTour'

type Bounds = { x: number; y: number; width: number; height: number }

const boundsOf = (el: HTMLElement): Bounds => {
  const r = el.getBoundingClientRect()
  return {
    x: Math.round(r.left),
    y: Math.round(r.top),
    width: Math.round(r.width),
    height: Math.round(r.height)
  }
}

/**
 * The study portal inside the app (Sulis, Brightspace, Blackboard, Moodle, anything): the page is a
 * native browser view laid over the area below the toolbar, signed in on its own. Study files
 * downloaded here go into the chosen course. Route: /portal?course=<id>
 */
export function PortalScreen(): React.JSX.Element {
  const [params] = useSearchParams()
  const state = usePortalState()
  const courses = useCourses()
  const open = usePortalOpen()
  const close = usePortalClose()
  const setBounds = usePortalBounds()
  const setCourse = usePortalCourse()
  const navigate = usePortalNavigate()
  const go = usePortalGo()
  const downloads = usePortalDownloads()
  const settings = useSettings()
  const updateSettings = useUpdateSettings()
  const portals = settings.data?.portals ?? []
  const savePortals = (next: SavedPortal[]): void => updateSettings.mutate({ portals: next })
  // Home shows the portal list; the page stays open (and signed in) behind it.
  const [home, setHome] = useState(true)
  const area = useRef<HTMLDivElement>(null)
  const [address, setAddress] = useState('')
  const [editing, setEditing] = useState(false)
  useAutoTour('portal', !state.isPending)

  const url = state.data?.url ?? null
  // The student's pick, else the course from the link that opened the screen, else the last one.
  const [picked, setPicked] = useState<{ id: string | null } | null>(null)
  const courseId = picked ? picked.id : (params.get('course') ?? state.data?.courseId ?? null)
  const target = useRef(courseId)
  useEffect(() => {
    target.current = courseId
  }, [courseId])
  const shown = url !== null && !home
  const saved = url !== null && portals.some((p) => p.url === url)
  const { mutate: openView } = open
  const { mutate: closeView } = close
  const { mutate: moveView } = setBounds

  // The native view covers the area only while a page is loaded; the start panel shows otherwise.
  useLayoutEffect(() => {
    const el = area.current
    if (!el || !shown) return
    openView({ bounds: boundsOf(el), courseId: target.current })
    const follow = (): void => moveView({ bounds: boundsOf(el) })
    // Not every test environment has ResizeObserver; window resizes still keep the view in place.
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(follow)
    observer?.observe(el)
    window.addEventListener('resize', follow)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', follow)
      closeView({})
    }
  }, [shown, openView, closeView, moveView])

  const visit = (target: string): void => {
    navigate.mutate({ url: target }, { onSuccess: () => setHome(false) })
    setEditing(false)
  }

  const courseName = (id: string | null): string =>
    (id !== null ? courses.data?.find((c) => c.id === id)?.name : undefined) ?? 'a new course'

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex h-12 shrink-0 items-center gap-1 border-b border-rule bg-paper px-3"
        data-tour="portal-bar"
      >
        <IconButton
          icon="home"
          label="Portal home"
          data-tour="portal-home"
          pressed={!shown}
          onClick={() => setHome(true)}
        />
        <IconButton
          icon="chevron-left"
          label="Back"
          disabled={!shown || !state.data?.canGoBack}
          onClick={() => go.mutate({ action: 'back' })}
        />
        <IconButton
          icon="chevron-right"
          label="Forward"
          disabled={!shown || !state.data?.canGoForward}
          onClick={() => go.mutate({ action: 'forward' })}
        />
        <IconButton
          icon={state.data?.loading ? 'close' : 'review'}
          label={state.data?.loading ? 'Stop' : 'Reload'}
          disabled={!shown}
          onClick={() => go.mutate({ action: state.data?.loading ? 'stop' : 'reload' })}
        />
        <form
          className="mx-2 flex min-w-0 flex-1"
          onSubmit={(e) => {
            e.preventDefault()
            if (address.trim()) visit(address)
          }}
        >
          <input
            aria-label="Portal address"
            value={editing ? address : (url ?? '')}
            placeholder="Your study portal, e.g. learn.ul.ie"
            onFocus={(e) => {
              setAddress(url ?? '')
              setEditing(true)
              e.currentTarget.select()
            }}
            onBlur={() => setEditing(false)}
            onChange={(e) => setAddress(e.target.value)}
            className={cx(fieldClass, 'h-8 w-full')}
          />
        </form>
        <IconButton
          icon="bookmark"
          label={saved ? 'In your portals' : 'Add this page to your portals'}
          pressed={saved}
          disabled={!shown || saved}
          onClick={() => {
            if (url) savePortals([...portals, { name: state.data?.title || new URL(url).hostname, url }])
          }}
        />
        <label className="flex items-center gap-2 text-sm text-graphite" data-tour="portal-course">
          Files go to
          <select
            value={courseId ?? ''}
            onChange={(e) => {
              const next = e.target.value || null
              setPicked({ id: next })
              setCourse.mutate({ courseId: next })
            }}
            className={cx(fieldClass, 'h-8 max-w-56 pr-8')}
          >
            <option value="">A new course per file</option>
            {(courses.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      {navigate.error ? <p className="px-4 py-1 text-sm text-redpen">{navigate.error.message}</p> : null}

      <div ref={area} className="relative min-h-0 flex-1 overflow-y-auto bg-sheet">
        {!shown ? (
          <PortalHome
            portals={portals}
            current={url !== null ? { url, title: state.data?.title ?? '' } : null}
            onOpen={visit}
            onContinue={() => setHome(false)}
            onChange={savePortals}
          />
        ) : null}
      </div>

      {downloads.length > 0 ? (
        <ul
          aria-label="Downloaded files"
          className="flex shrink-0 flex-wrap gap-x-5 gap-y-1 border-t border-rule bg-paper px-4 py-2 text-sm"
        >
          {downloads.slice(0, 6).map((d, i) => (
            <li
              key={`${d.fileName}-${i}`}
              className={cx('flex items-center gap-1.5', d.error ? 'text-redpen' : 'text-ink')}
            >
              <Icon name={d.error ? 'alert' : 'check'} size={14} />
              {d.error ? `${d.fileName}: ${d.error}` : `${d.fileName} → ${courseName(d.courseId)}`}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
