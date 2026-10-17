import { findClaudeExecutable } from './locate'

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

  it('returns null when Claude Code is not installed', () => {
    expect(findClaudeExecutable({ PATH: '/usr/bin' }, () => false, '/home/u', 'linux')).toBeNull()
  })
})
