import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { posix, win32 } from 'node:path'

/** Installed by the Flatpak manifest: runs the user's Codex on the host (flatpak/codex-host.sh). */
export const FLATPAK_CODEX_WRAPPER = '/app/bin/codex-host'

/**
 * Finds the user's Codex CLI. Desktop launchers often start apps without the user's PATH, hence the
 * usual install locations (npm global, Homebrew, ~/.local/bin). Null when it is not installed.
 */
export function findCodexExecutable(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform
): string | null {
  if (env['FLATPAK_ID'] && exists(FLATPAK_CODEX_WRAPPER)) return FLATPAK_CODEX_WRAPPER
  const path = platform === 'win32' ? win32 : posix
  const names = platform === 'win32' ? ['codex.cmd', 'codex.exe'] : ['codex']
  const dirs = [
    ...(env['PATH'] ?? '').split(path.delimiter).filter(Boolean),
    path.join(home, '.local', 'bin'),
    path.join(home, '.npm-global', 'bin'),
    ...(platform === 'win32' && env['APPDATA'] ? [path.join(env['APPDATA'], 'npm')] : []),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin'
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = path.join(dir, name)
      if (exists(candidate)) return candidate
    }
  }
  return null
}
