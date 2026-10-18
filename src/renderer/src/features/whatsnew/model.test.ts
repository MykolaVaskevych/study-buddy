import { groupByVersion, pendingEntries, type WhatsNewEntry } from './model'

const e = (hash: string, version: string | null, kind: 'feat' | 'fix' = 'feat'): WhatsNewEntry => ({
  hash,
  date: '2026-10-18',
  version,
  kind,
  title: hash,
  detail: null
})
const entries = [e('d', null), e('c', null, 'fix'), e('b', 'v0.1.0'), e('a', 'v0.1.0')]

describe("what's new", () => {
  it('shows what came after the last entry seen', () => {
    expect(pendingEntries(entries, 'b', true).map((x) => x.hash)).toEqual(['d', 'c'])
    expect(pendingEntries(entries, 'd', true)).toEqual([])
  })

  it('new users see nothing; returning users without a record see unreleased work', () => {
    expect(pendingEntries(entries, null, false)).toEqual([])
    expect(pendingEntries(entries, null, true).map((x) => x.hash)).toEqual(['d', 'c'])
  })

  it('ignores an unknown last-seen entry (rewritten history)', () => {
    expect(pendingEntries(entries, 'zzz', true)).toEqual([])
  })

  it('groups by release', () => {
    expect(groupByVersion(entries).map((g) => [g.version, g.items.length])).toEqual([
      [null, 2],
      ['v0.1.0', 2]
    ])
  })
})
