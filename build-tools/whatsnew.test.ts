import { detailOf, parseLog } from './whatsnew'

const rec = (hash: string, subject: string, body = ''): string =>
  `${hash}\x1f2026-10-18T10:00:00Z\x1f${subject}\x1f${body}\x1e`

describe('whatsnew from git log', () => {
  it('keeps user-facing feat/fix commits, labels them by release, and cleans titles', () => {
    const raw = [
      rec(
        'c3',
        'feat: exam profile drives flashcards (#43)',
        "Problem first.\n\nWhat's new: Flashcards now match your exam."
      ),
      rec('c2', 'fix(release): upload the flatpak file (#42)'),
      rec('c1', 'feat(ui): study book (#41)', '- lessons table\n- job'),
      rec('c0', 'chore: tidy')
    ].join('\n')
    const entries = parseLog(raw, new Map([['c1', 'v0.1.0']]))
    expect(entries.map((e) => [e.hash, e.version, e.title, e.detail])).toEqual([
      ['c3', null, 'Exam profile drives flashcards', 'Flashcards now match your exam.'],
      ['c1', 'v0.1.0', 'Study book', null]
    ])
  })

  it('falls back to the first prose paragraph', () => {
    expect(detailOf('Turns slides into chapters.\n\n- internal bullet')).toBe('Turns slides into chapters.')
    expect(detailOf('Closes #3')).toBeNull()
  })
})
