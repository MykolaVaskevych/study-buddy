import { isImportable } from '@shared/files'
import type { PortalNewFiles } from '@shared/domain'
import type { PageSnapshot } from './snapshot'

type FileLink = PortalNewFiles['items'][number]
const LMS_CONTENT =
  /\/(?:d2l\/le\/content\/.*\/viewContent(?:\/|$)|mod\/resource(?:\/|$)|access\/content\/|bbcswebdav\/)/i

/** Keep unique web links to study files or known LMS content items; never actions or forms. */
export function fileLinks(page: PageSnapshot): FileLink[] {
  const links = new Map<string, FileLink>()
  for (const element of page.elements) {
    if (element.kind !== 'link' || !element.href) continue
    try {
      const url = new URL(element.href, page.url)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue
      const path = decodeURIComponent(url.pathname)
      // Fragments point into the same file; changes to them are not new course material.
      url.hash = ''
      if (
        !isImportable(url.href) &&
        !isImportable(path) &&
        !isImportable(element.label.trim()) &&
        !LMS_CONTENT.test(path)
      )
        continue
      if (!links.has(url.href)) links.set(url.href, { label: element.label, href: url.href })
    } catch {
      // A malformed link must not prevent checking the rest of the page.
    }
  }
  return [...links.values()]
}

/** Compare by address so a renamed label does not announce the same file again. */
export function newFileLinks(links: FileLink[], seenLinks: readonly string[]): FileLink[] {
  const seen = new Set(seenLinks)
  return links.filter((link) => !seen.has(link.href))
}

/**
 * Redirects and sign-in screens must not replace a course's successful baseline. Same site and
 * path is enough: portals add or reorder query parameters (session ids, ?ou=) on the same page.
 */
export function isWatchPage(page: PageSnapshot, address: string): boolean {
  const canonical = (value: string): string => {
    const url = new URL(value)
    return `${url.origin}${url.pathname.replace(/\/$/, '')}`
  }
  try {
    return (
      canonical(page.url) === canonical(address) &&
      !/\b(sign in|log in|login|session expired|access denied)\b/i.test(
        [page.title, ...page.headings].join(' ')
      )
    )
  } catch {
    return false
  }
}
