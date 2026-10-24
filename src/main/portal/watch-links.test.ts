import { IMAGE_EXTENSIONS, IMPORT_EXTENSIONS } from '@shared/files'
import type { PageSnapshot } from './snapshot'
import { fileLinks, isWatchPage, newFileLinks } from './watch-links'

const page = (links: [string, string][]): PageSnapshot => ({
  url: 'https://portal.edu/course',
  title: 'Course',
  headings: [],
  text: '',
  elements: links.map(([href, label], id) => ({ id, kind: 'link', href, label, expanded: null }))
})

describe('watch links', () => {
  it('recognizes every study extension in paths or labels, with query strings and case differences', () => {
    const documents = IMPORT_EXTENSIONS.filter((e) => !(IMAGE_EXTENSIONS as readonly string[]).includes(e))
    const links = documents.flatMap((extension): [string, string][] => [
      [`/notes.${extension.toUpperCase()}?download=1#page=2`, 'Notes'],
      [`/download/${extension}`, `Slides.${extension}`],
      [`/download?file=notes.${extension}`, 'Download']
    ])
    expect(fileLinks(page(links))).toHaveLength(links.length)
    expect(fileLinks(page(links))[0]?.href).toBe('https://portal.edu/notes.PDF?download=1')
    // Pictures are not lecture material here: portal pages link logos, avatars and banners.
    expect(
      fileLinks(
        page([
          ['/banner.JPG', 'Banner'],
          ['/avatar', 'me.png']
        ])
      )
    ).toEqual([])
  })

  it('recognizes LMS items, deduplicates URLs and rejects actions and unrelated links', () => {
    const lms = [
      '/d2l/le/content/123/viewContent/456/View',
      '/mod/resource/view.php?id=1',
      '/access/content/group/a',
      '/bbcswebdav/a'
    ]
    const snapshot = page([
      ...lms.map((href): [string, string] => [href, 'Lecture']),
      ['/notes%2Epdf', 'Notes'],
      ['/notes%2Epdf#page=3', 'Duplicate'],
      ['/course', 'Course'],
      ['/logo.png', 'Logo'],
      ['javascript:alert(1)', 'notes.pdf'],
      ['file:///notes.pdf', 'notes.pdf'],
      ['/bad%xx.pdf', 'Malformed']
    ])
    snapshot.elements.push({ id: 99, kind: 'submit', href: '/submit.pdf', label: 'Submit', expanded: null })
    snapshot.elements.push({ id: 100, kind: 'link', href: null, label: 'notes.pdf', expanded: null })
    expect(fileLinks(snapshot)).toHaveLength(5)
  })

  it('diffs by address, ignoring renamed labels and absent links', () => {
    const links = fileLinks(
      page([
        ['/a.pdf', 'Renamed'],
        ['/b.pdf', 'New']
      ])
    )
    expect(newFileLinks(links, ['https://portal.edu/a.pdf', 'https://portal.edu/old.pdf'])).toEqual([
      { label: 'New', href: 'https://portal.edu/b.pdf' }
    ])
    expect(newFileLinks([], ['https://portal.edu/a.pdf'])).toEqual([])
  })

  it('skips redirects and sign-in screens without mistaking a logout link for a signed-out page', () => {
    const snapshot = page([['/logout', 'Sign out']])
    expect(isWatchPage(snapshot, snapshot.url)).toBe(true)
    expect(isWatchPage({ ...snapshot, url: 'https://sso.edu/login' }, snapshot.url)).toBe(false)
    // Portals add query parameters to the same page; that is still the watched page.
    expect(isWatchPage({ ...snapshot, url: `${snapshot.url}?ou=12345&sid=x` }, snapshot.url)).toBe(true)
    expect(isWatchPage({ ...snapshot, title: 'Sign in' }, snapshot.url)).toBe(false)
    expect(isWatchPage({ ...snapshot, headings: ['Session expired'] }, snapshot.url)).toBe(false)
    expect(isWatchPage(snapshot, 'bad address')).toBe(false)
  })
})
