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
  const theme = settings.data?.theme ?? 'system'

  return (
    <nav
      aria-label="Sections"
      className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1 border-r border-rule bg-paper py-3"
    >
      <span aria-hidden className="mb-3 font-serif text-xl font-bold italic">
        <span className="marker-stroke">Sb</span>
      </span>
      {navRoutes().map(({ path, nav }) => (
        <Tooltip key={path} label={nav.label} shortcut={nav.shortcut} side="right">
          <NavLink
            to={path}
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
      <div className="mt-auto">
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
