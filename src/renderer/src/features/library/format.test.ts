import { examCountdown, highlightParts, relativeDay, spineIndex } from './format'
import { resolveDrop } from './useDropImport'

const now = new Date(2026, 9, 17, 14, 0)
const inDays = (d: number): string => new Date(2026, 9, 17 + d, 9, 0).toISOString()

describe('examCountdown', () => {
  it('counts calendar days and grades urgency', () => {
    expect(examCountdown(null, now)).toBeNull()
    expect(examCountdown(inDays(9), now)).toEqual({ text: 'Exam in 9 days', urgency: 'calm' })
    expect(examCountdown(inDays(5), now)).toEqual({ text: 'Exam in 5 days', urgency: 'soon' })
    expect(examCountdown(inDays(3), now)?.urgency).toBe('urgent')
    expect(examCountdown(inDays(1), now)?.text).toBe('Exam tomorrow')
    expect(examCountdown(inDays(0), now)?.text).toBe('Exam today')
    expect(examCountdown(inDays(-2), now)?.text).toBe('Exam passed')
  })
})

describe('relativeDay', () => {
  it('reads naturally', () => {
    expect(relativeDay(inDays(0), now)).toBe('today')
    expect(relativeDay(inDays(-1), now)).toBe('yesterday')
    expect(relativeDay(inDays(-4), now)).toBe('4 days ago')
  })
})

describe('highlightParts', () => {
  it('marks matched terms case-insensitively', () => {
    expect(highlightParts('The Power budget closes', 'power budget')).toEqual([
      { text: 'The ', match: false },
      { text: 'Power', match: true },
      { text: ' ', match: false },
      { text: 'budget', match: true },
      { text: ' closes', match: false }
    ])
  })
  it('escapes regex characters in the query', () => {
    expect(highlightParts('a (b) c', '(b)')).toContainEqual({ text: '(b)', match: true })
  })
})

describe('spineIndex', () => {
  it('is stable and within 1..6', () => {
    expect(spineIndex('optical-networks')).toBe(spineIndex('optical-networks'))
    expect(spineIndex('x')).toBeGreaterThanOrEqual(1)
    expect(spineIndex('x')).toBeLessThanOrEqual(6)
  })
})

describe('resolveDrop', () => {
  const file = (name: string, type = ''): File => new File(['x'], name, { type })
  it('keeps PDFs and resolves their paths', () => {
    const r = resolveDrop([file('a.pdf'), file('b.PDF'), file('c.png', 'image/png')], (f) => `/tmp/${f.name}`)
    expect(r).toEqual({ paths: ['/tmp/a.pdf', '/tmp/b.PDF'], rejected: 1 })
  })
  it('returns null paths when the bridge cannot resolve files', () => {
    expect(resolveDrop([file('a.pdf')], () => null).paths).toBeNull()
  })
})
