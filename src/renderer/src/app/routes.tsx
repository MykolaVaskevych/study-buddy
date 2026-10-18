import type { ComponentType } from 'react'
import type { RouteObject } from 'react-router'
import type { IconName } from '../components'
import { LibraryScreen } from '../features/library/LibraryScreen'

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

export const appRoutes: AppRoute[] = [
  { path: '/', Component: LibraryScreen, nav: { label: 'Library', icon: 'library', shortcut: 'Mod+1' } },
  {
    path: '/book/:docId',
    lazy: () => import('../features/reader/BookScreen').then((m) => m.BookScreen)
  },
  {
    path: '/review',
    lazy: () => import('../features/review/ReviewScreen').then((m) => m.ReviewScreen),
    nav: { label: 'Review', icon: 'review', shortcut: 'Mod+2' }
  },
  {
    path: '/planner',
    lazy: () => import('../features/planner/PlannerIndexScreen').then((m) => m.PlannerIndexScreen),
    nav: { label: 'Planner', icon: 'planner', shortcut: 'Mod+3' }
  },
  {
    path: '/settings',
    lazy: () => import('../features/settings/SettingsScreen').then((m) => m.SettingsScreen),
    nav: { label: 'Settings', icon: 'settings', shortcut: 'Mod+4' }
  },
  {
    path: '/book/:docId/plan',
    lazy: () => import('../features/planner/PlannerScreen').then((m) => m.PlannerScreen)
  },
  {
    path: '/book/:docId/overview',
    lazy: () => import('../features/overview/OverviewScreen').then((m) => m.OverviewScreen)
  },
  {
    path: '/book/:docId/studybook',
    lazy: () => import('../features/studybook/StudyBookScreen').then((m) => m.StudyBookScreen)
  },
  {
    path: '/book/:docId/sheet',
    lazy: () => import('../features/sheet/CheatSheetScreen').then((m) => m.CheatSheetScreen)
  },
  {
    path: '/book/:docId/quiz',
    lazy: () => import('../features/quiz/QuizScreen').then((m) => m.QuizScreen)
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
