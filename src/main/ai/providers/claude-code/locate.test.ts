import { delimiter, join } from 'node:path'
import { FLATPAK_CLAUDE_WRAPPER, findClaudeExecutable } from './locate'

describe('findClaudeExecutable', () => {
  it('prefers PATH, then well-known install locations', () => {
    // join/delimiter keep the test valid on Windows runners too.
    const home = join('home', 'u')
    const local = join(home, '.local', 'bin', 'claude')
    const opt = join('opt', 'x', 'claude')
    const exists = (p: string): boolean => p === local || p === opt
    const path = [join('opt', 'x'), 'usr'].join(delimiter)
    expect(findClaudeExecutable({ PATH: path }, exists, home, 'linux')).toBe(opt)
    expect(findClaudeExecutable({ PATH: 'usr' }, exists, home, 'linux')).toBe(local)
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
