import { Window } from 'happy-dom'
import {
  allowedClick,
  clickScript,
  describeSnapshot,
  pageSnapshotSchema,
  siteOf,
  SNAPSHOT_SCRIPT
} from './snapshot'
import type { PageElement } from './snapshot'

const el = (over: Partial<PageElement>): PageElement => ({
  id: 0,
  kind: 'button',
  label: 'Download',
  href: null,
  expanded: null,
  ...over
})

describe('portal guardrails', () => {
  const page = 'https://learn.ul.ie/d2l/le/content/123/Home'
  it('allows downloads, expanders and links within the portal', () => {
    expect(allowedClick(el({}), page)).toEqual({ ok: true })
    expect(allowedClick(el({ kind: 'expander', label: 'Week 5' }), page)).toEqual({ ok: true })
    expect(
      allowedClick(
        el({
          kind: 'link',
          label: 'Lecture 5',
          href: 'https://learn.ul.ie/d2l/le/content/123/viewContent/9/View'
        }),
        page
      )
    ).toEqual({ ok: true })
    expect(
      allowedClick(el({ kind: 'link', label: 'Files', href: 'https://files.ul.ie/x.pdf' }), page)
    ).toEqual({ ok: true })
  })

  it('refuses anything that submits, deletes, signs out or leaves the portal', () => {
    for (const label of [
      'Delete',
      'Submit assignment',
      'Sign out',
      'Log out',
      'Unenrol',
      'Post reply',
      'Send message'
    ]) {
      expect(allowedClick(el({ label }), page).ok).toBe(false)
    }
    expect(allowedClick(el({ kind: 'submit', label: 'Go' }), page).ok).toBe(false)
    expect(
      allowedClick(el({ kind: 'link', label: 'Win a prize', href: 'https://evil.example/x' }), page)
    ).toMatchObject({
      ok: false,
      reason: /leaves the portal/
    })
    expect(allowedClick(el({ kind: 'link', label: 'x', href: 'file:///etc/passwd' }), page).ok).toBe(false)
  })

  it('knows which hosts belong to one site', () => {
    expect(siteOf('learn.ul.ie')).toBe('ul.ie')
    expect(siteOf('moodle.cs.ox.ac.uk')).toBe('ox.ac.uk')
    expect(siteOf('canvas.instructure.com')).toBe('instructure.com')
  })
})

describe('page snapshot', () => {
  it('lists clickable elements, also inside shadow roots, and clicks them by number', () => {
    const window = new Window({ url: 'https://learn.ul.ie/d2l/le/content/123/Home' })
    const { document } = window
    document.body.innerHTML = `
      <h1>Scalable Computing</h1>
      <button aria-expanded="false">Week 5</button>
      <a href="/d2l/le/content/123/viewContent/9/View">W5_L5.1 MapReduce</a>
      <form><button type="submit">Search</button></form>
      <d2l-button-host text="Download"></d2l-button-host>
      <span>not clickable</span>`
    const host = document.querySelector('d2l-button-host')!
    const shadow = host.attachShadow({ mode: 'open' })
    shadow.innerHTML = '<button aria-label="Download original file"></button>'
    let clicked = ''
    shadow.querySelector('button')?.addEventListener('click', () => {
      clicked = 'download'
    })
    // happy-dom does no layout: every element counts as visible.
    const proto = window.HTMLElement.prototype as unknown as { getBoundingClientRect: () => unknown }
    proto.getBoundingClientRect = () => ({ width: 10, height: 10 })
    const raw: unknown = window.eval(SNAPSHOT_SCRIPT)
    const snap = pageSnapshotSchema.parse(raw)
    expect(snap.headings).toEqual(['Scalable Computing'])
    expect(snap.elements.map((e) => [e.kind, e.label])).toEqual([
      ['expander', 'Week 5'],
      ['link', 'W5_L5.1 MapReduce'],
      ['submit', 'Search'],
      ['button', 'Download original file']
    ])
    expect(snap.elements[0]?.expanded).toBe(false)
    expect(snap.elements[1]?.href).toBe('https://learn.ul.ie/d2l/le/content/123/viewContent/9/View')
    expect(window.eval(clickScript(3))).toBe(true)
    expect(clicked).toBe('download')
    expect(window.eval(clickScript(99))).toBe(false)
    expect(describeSnapshot(snap)).toContain('[0] Week 5 (expander, collapsed)')
    window.close()
  })
})
