import { createHashRouter, createMemoryRouter } from 'react-router'
import type { RouteObject } from 'react-router'
import { RouteError } from './ErrorBoundary'
import { Layout } from './Layout'
import { appRoutes, toRouteObjects } from './routes'

export const routeTree = (): RouteObject[] => [
  { path: '/', Component: Layout, errorElement: <RouteError />, children: toRouteObjects(appRoutes) }
]

/** Hash routing: the packaged app loads index.html from file://, where history URLs break. */
export const createAppRouter = () => createHashRouter(routeTree())

/** Tests start at any URL, e.g. createTestRouter(['/book/x?page=3']). */
export const createTestRouter = (initialEntries: string[] = ['/']) =>
  createMemoryRouter(routeTree(), { initialEntries })
