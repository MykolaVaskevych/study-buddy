/** Markdown notes: what the library needs to know before they are printed to PDF. */

/** The first level-1 heading (ATX "# Title"), without Markdown emphasis; else `fallback`. */
export function markdownTitle(markdown: string, fallback: string): string {
  const match = /^#[ \t]+(.+?)[ \t#]*$/m.exec(markdown.replace(/^\uFEFF/, ''))
  const title = match?.[1]?.replace(/[*_`]/g, '').replace(/\s+/g, ' ').trim()
  return title ? title.slice(0, 200) : fallback
}
