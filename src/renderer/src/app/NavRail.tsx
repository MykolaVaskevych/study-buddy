import { useLocation } from 'react-router'
import { useTour } from '../features/tour/tourStore'
import { tourForPath } from '../features/tour/tours'
import logoUrl from '../assets/logo.png'
import { NavLink } from 'react-router'
import { useSettings, useUpdateSettings } from '../api/hooks'
import { cx, Icon, IconButton, Tooltip } from '../components'
import type { IconName } from '../components'
import { navRoutes } from './routes'
import { nextTheme } from './theme'
import type { ThemeSetting } from './theme'

const themeIcon: Record<ThemeSetting, IconName> = { system: 'monitor', light: 'sun', dark: 'moon' }
const themeLabel: Record<ThemeSetting, string> = {
  system: 'Theme: follows the system',
  light: 'Theme: light',
  dark: 'Theme: dark'
}

/** Slim left rail: the app's sections, built from the route registry. */
export function NavRail(): React.JSX.Element {
  const settings = useSettings()
  const update = useUpdateSettings()
  const location = useLocation()
  const startTour = useTour((t) => t.start)
  const theme = settings.data?.theme ?? 'system'

  return (
    <nav
      aria-label="Sections"
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r border-rule bg-paper py-3"
    >
      <img
        src={logoUrl}
        alt=""
        aria-hidden
        className="mb-3 size-9 rounded-[0.6rem] select-none"
        draggable={false}
      />
      {navRoutes().map(({ path, nav }) => (
        <Tooltip key={path} label={nav.label} shortcut={nav.shortcut} side="right">
          <NavLink
            to={path}
            data-tour={`nav-${path}`}
            end={path === '/'}
            className={({ isActive }) =>
              cx(
                'group flex w-14 flex-col items-center gap-1 rounded-md py-1.5 text-2xs font-semibold transition-colors',
                isActive ? 'text-ink' : 'text-graphite hover:bg-sunken hover:text-ink'
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cx(
                    'inline-flex h-7 w-10 items-center justify-center rounded-md',
                    isActive && 'bg-marker text-marker-ink'
                  )}
                >
                  <Icon name={nav.icon} size={18} />
                </span>
                {nav.label}
              </>
            )}
          </NavLink>
        </Tooltip>
      ))}
      <div className="mt-auto flex flex-col items-center gap-1">
        <span data-tour="help">
          <IconButton
            icon="help"
            label="Show the tour for this screen"
            tooltipSide="right"
            onClick={() => startTour(tourForPath(location.pathname))}
          />
        </span>
        <IconButton
          icon={themeIcon[theme]}
          label={themeLabel[theme]}
          tooltipSide="right"
          onClick={() => update.mutate({ theme: nextTheme(theme) })}
        />
      </div>
    </nav>
  )
}
