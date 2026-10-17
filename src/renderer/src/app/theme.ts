import { useEffect, useSyncExternalStore } from 'react'
import type { Settings } from '@shared/settings'
import { useSettings } from '../api/hooks'

export type ThemeSetting = Settings['theme']
export type ResolvedTheme = 'light' | 'dark'

/** Resolves the settings value against the OS preference. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): ResolvedTheme {
  if (setting === 'system') return systemDark ? 'dark' : 'light'
  return setting
}

const CACHE_KEY = 'sb-theme'

function cachedSetting(): ThemeSetting {
  try {
    const v = window.localStorage.getItem(CACHE_KEY)
    return v === 'light' || v === 'dark' || v === 'system' ? v : 'system'
  } catch {
    return 'system'
  }
}

const darkQuery = (): MediaQueryList | null =>
  typeof window.matchMedia === 'function' ? window.matchMedia('(prefers-color-scheme: dark)') : null

function subscribeSystemDark(onChange: () => void): () => void {
  const query = darkQuery()
  query?.addEventListener('change', onChange)
  return () => query?.removeEventListener('change', onChange)
}

function useSystemDark(): boolean {
  return useSyncExternalStore(subscribeSystemDark, () => darkQuery()?.matches ?? false)
}

/**
 * Applies the theme from settings to <html data-theme>. The last value is cached locally so the
 * next launch paints in the right theme before settings arrive over IPC.
 */
export function useThemeSync(): ResolvedTheme {
  const settings = useSettings()
  const setting = settings.data?.theme ?? cachedSetting()
  const resolved = resolveTheme(setting, useSystemDark())
  useEffect(() => {
    document.documentElement.dataset['theme'] = resolved
    try {
      window.localStorage.setItem(CACHE_KEY, setting)
    } catch {
      // Storage blocked: the theme still applies for this session.
    }
  }, [resolved, setting])
  return resolved
}

const order: ThemeSetting[] = ['system', 'light', 'dark']

export function nextTheme(current: ThemeSetting): ThemeSetting {
  return order[(order.indexOf(current) + 1) % order.length] ?? 'system'
}
