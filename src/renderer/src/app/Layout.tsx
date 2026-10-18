import { WhatsNew } from '../features/whatsnew/WhatsNew'
import { TourOverlay } from '../features/tour/TourOverlay'
import { useMemo } from 'react'
import { Outlet, useLocation, useNavigate } from 'react-router'
import { ErrorBoundary } from './ErrorBoundary'
import { NavRail } from './NavRail'
import { RateLimitBanner } from './RateLimitBanner'
import { navRoutes } from './routes'
import { useShortcuts } from './shortcuts'
import { StatusBar } from './StatusBar'
import { Toaster } from './Toaster'

/** App frame: rail | (banner + screen) over a status bar. */
export function Layout(): React.JSX.Element {
  const navigate = useNavigate()
  const location = useLocation()
  const shortcuts = useMemo(
    () => Object.fromEntries(navRoutes().map((r) => [r.nav.shortcut, () => void navigate(r.path)])),
    [navigate]
  )
  useShortcuts(shortcuts)

  return (
    <div className="flex h-screen max-h-screen flex-col overflow-hidden">
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="contents print:hidden">
          <NavRail />
        </div>
        <main className="flex min-w-0 flex-1 flex-col">
          <RateLimitBanner />
          <div className="min-h-0 flex-1">
            <ErrorBoundary resetKey={location.pathname}>
              <Outlet />
            </ErrorBoundary>
          </div>
        </main>
      </div>
      <div className="contents print:hidden">
        <StatusBar />
      </div>
      <Toaster />
      <TourOverlay />
      <WhatsNew />
    </div>
  )
}
