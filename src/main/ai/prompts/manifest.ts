import type { PageTextLookup } from '../types'
import { PAGE_LABEL_PATTERN, pageLabel } from './common'

/**
 * The page manifest lists every page the model must handle and whether it has a text layer.
 * It anchors page numbers (the model cross-checks them with the SB-PAGE stamps), tells the model
 * which pages are image-only so it reads the slide image, and, with snippets, lets it confirm
 * it is looking at the right page. The fake provider reads it to know which pages exist.
 */

export interface ManifestEntry {
  page: number
  imageOnly: boolean
  /** Opening text of the page (verbatim, whitespace collapsed), when requested. */
  snippet: string | null
}

const HEADER = 'Page manifest (page stamp | text layer | opening text):'

/** First `max` characters of the page text, cut at a word boundary. */
export function snippetOf(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed.length <= max) return collapsed
  const cut = collapsed.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return (space > max / 2 ? cut.slice(0, space) : cut).trimEnd()
}

/** Manifest entries for pages from..to; snippetChars = 0 omits the opening text. */
export function manifestEntries(
  from: number,
  to: number,
  pageText: PageTextLookup,
  snippetChars: number
): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  for (let page = from; page <= to; page++) {
    const text = pageText(page)
    const imageOnly = text.trim() === ''
    entries.push({
      page,
      imageOnly,
      snippet: imageOnly || snippetChars <= 0 ? null : snippetOf(text, snippetChars)
    })
  }
  return entries
}

export function formatManifest(entries: readonly ManifestEntry[]): string {
  const lines = entries.map((e) => {
    if (e.imageOnly) return `${pageLabel(e.page)} | image-only (no text layer: read the slide image)`
    return e.snippet === null
      ? `${pageLabel(e.page)} | text`
      : `${pageLabel(e.page)} | text | ${JSON.stringify(e.snippet)}`
  })
  return [HEADER, ...lines].join('\n')
}

/** Inverse of `formatManifest` (lines that do not parse are skipped). */
export function parseManifest(text: string): ManifestEntry[] {
  const entries: ManifestEntry[] = []
  const pattern = new RegExp(`^${PAGE_LABEL_PATTERN} \\| (image-only|text)(?: \\| (".*"))?`)
  for (const line of text.split('\n')) {
    const match = pattern.exec(line)
    if (!match?.[1]) continue
    entries.push({
      page: Number(match[1]),
      imageOnly: match[2] === 'image-only',
      snippet: match[3] === undefined ? null : parseQuoted(match[3])
    })
  }
  return entries
}

function parseQuoted(quoted: string): string | null {
  try {
    const parsed: unknown = JSON.parse(quoted)
    return typeof parsed === 'string' ? parsed : null
  } catch {
    return null
  }
}
