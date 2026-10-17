import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'

/**
 * Finds the user's installed Claude Code executable. The subscription provider needs a logged-in
 * Claude Code anyway, and the packaged app does not ship the SDK's 270 MB bundled binary.
 * Desktop launchers often start apps without ~/.local/bin on PATH, hence the explicit locations.
 * Returns null when nothing is found (the SDK then falls back to its bundled binary, present in dev).
 */
export function findClaudeExecutable(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  home: string = homedir(),
  platform: NodeJS.Platform = process.platform
): string | null {
  const names = platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const dirs = [
    ...(env['PATH'] ?? '').split(delimiter).filter(Boolean),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin'
  ]
  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name)
      if (exists(candidate)) return candidate
    }
  }
  return null
}
