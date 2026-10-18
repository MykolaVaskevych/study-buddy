import { delimiter, join } from 'node:path'
import { FLATPAK_CLAUDE_WRAPPER, findClaudeExecutable } from './locate'

describe('findClaudeExecutable', () => {
  it('prefers PATH, then well-known install locations', () => {
    const present = new Set(['/home/u/.local/bin/claude', '/opt/x/claude'])
    const exists = (p: string): boolean => present.has(p)
    expect(findClaudeExecutable({ PATH: '/opt/x:/usr/bin' }, exists, '/home/u', 'linux')).toBe(
      '/opt/x/claude'
    )
    expect(findClaudeExecutable({ PATH: '/usr/bin' }, exists, '/home/u', 'linux')).toBe(
      '/home/u/.local/bin/claude'
    )
  })

  it('uses the host wrapper inside the Flatpak sandbox', () => {
    const exists = (p: string): boolean => p === FLATPAK_CLAUDE_WRAPPER
    expect(findClaudeExecutable({ FLATPAK_ID: 'io.github.x', PATH: '' }, exists, 'h', 'linux')).toBe(
      FLATPAK_CLAUDE_WRAPPER
    )
  })

  it('returns null when Claude Code is not installed', () => {
    expect(findClaudeExecutable({ PATH: '/usr/bin' }, () => false, '/home/u', 'linux')).toBeNull()
  })
})
