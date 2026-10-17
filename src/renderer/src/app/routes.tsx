import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import type { IconName } from '../components'
import { LibraryScreen } from '../features/library/LibraryScreen'
import { Placeholder } from './Placeholder'

/**
 * Route registry. To add a screen (Wave 2):
 *   1. create `features/<name>/<Name>Screen.tsx`,
 *   2. add an entry here (or replace a placeholder's `Component` with a `lazy` import),
 *   3. give it `nav` to show it in the rail; `shortcut` becomes its Mod+N hotkey.
 * Nothing else needs to change: the router and the rail are built from this list.
 */

export interface NavEntry {
  label: string
  icon: IconName
  /** Global shortcut, e.g. "Mod+1". */
  shortcut: string
}

export interface AppRoute {
  /** Absolute path, e.g. "/book/:docId". "/" is the library. */
  path: string
  nav?: NavEntry
  Component?: ComponentType
  /** Code-split screens: resolved before the navigation completes. */
  lazy?: () => Promise<ComponentType>
}

const ReviewPlaceholder = (): React.JSX.Element => (
  <Placeholder
    title="Review"
    icon="review"
    body="Your due flashcards from every book, scheduled so the important ones are fresh on exam day."
  />
)
const PlannerPlaceholder = (): React.JSX.Element => (
  <Placeholder
    title="Planner"
    icon="planner"
    body="Tell it how many hours you have; it picks what to study, what to skim and what to skip."
  />
)
const SettingsPlaceholder = (): React.JSX.Element => (
  <Placeholder
    title="Settings"
    icon="settings"
    body="Claude connection, models, content language and theme."
  />
)

export const appRoutes: AppRoute[] = [
  { path: '/', Component: LibraryScreen, nav: { label: 'Library', icon: 'library', shortcut: 'Mod+1' } },
  {
    path: '/book/:docId',
    lazy: () => import('../features/reader/BookScreen').then((m) => m.BookScreen)
  },
  {
    path: '/review',
    Component: ReviewPlaceholder,
    nav: { label: 'Review', icon: 'review', shortcut: 'Mod+2' }
  },
  {
    path: '/planner',
    Component: PlannerPlaceholder,
    nav: { label: 'Planner', icon: 'planner', shortcut: 'Mod+3' }
  },
  {
    path: '/settings',
    Component: SettingsPlaceholder,
    nav: { label: 'Settings', icon: 'settings', shortcut: 'Mod+4' }
  }
]

export const navRoutes = (): (AppRoute & { nav: NavEntry })[] =>
  appRoutes.filter((r): r is AppRoute & { nav: NavEntry } => r.nav !== undefined)

/** Converts the registry to react-router children of the layout route. */
export function toRouteObjects(routes: AppRoute[]): RouteObject[] {
  return routes.map((r): RouteObject => {
    const path = r.path.replace(/^\//, '')
    const { lazy, Component } = r
    if (lazy) {
      const load = async (): Promise<{ Component: ComponentType }> => ({ Component: await lazy() })
      return path === '' ? { index: true, lazy: load } : { path, lazy: load }
    }
    return path === '' ? { index: true, Component } : { path, Component }
  })
}
