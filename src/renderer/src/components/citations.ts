import type { Parent, PhrasingContent, Root, Text } from 'mdast'

/** Matches "[p. 12]", "[p.12]", "[pp. 12-14]" and "[pp. 12–14]". */
const CITATION = /\[(?:pp?)\.\s?(\d{1,5})(?:\s?[–-]\s?(\d{1,5}))?\]/g

export interface CitationMatch {
  start: number
  end: number
  page: number
  /** Last page of a range citation, null for a single page. */
  pageEnd: number | null
  text: string
}

/** Finds page citations in plain text. Pages are 1-based absolute PDF pages. */
export function findCitations(text: string): CitationMatch[] {
  const out: CitationMatch[] = []
  for (const m of text.matchAll(CITATION)) {
    const page = Number(m[1])
    if (!Number.isFinite(page) || page < 1) continue
    const end = m[2] ? Number(m[2]) : null
    out.push({
      start: m.index,
      end: m.index + m[0].length,
      page,
      pageEnd: end !== null && end > page ? end : null,
      text: m[0]
    })
  }
  return out
}

function splitText(node: Text): PhrasingContent[] | null {
  const matches = findCitations(node.value)
  if (matches.length === 0) return null
  const parts: PhrasingContent[] = []
  let cursor = 0
  for (const m of matches) {
    if (m.start > cursor) parts.push({ type: 'text', value: node.value.slice(cursor, m.start) })
    // Rendered as <cite data-page> and swapped for a button by the Markdown component. Raw HTML
    // is never rendered, so every <cite> in the output comes from here.
    parts.push({
      type: 'emphasis',
      children: [{ type: 'text', value: m.text }],
      data: {
        hName: 'cite',
        hProperties: { dataPage: String(m.page), dataPageEnd: m.pageEnd === null ? '' : String(m.pageEnd) }
      }
    })
    cursor = m.end
  }
  if (cursor < node.value.length) parts.push({ type: 'text', value: node.value.slice(cursor) })
  return parts
}

const SKIP = new Set(['link', 'linkReference', 'code', 'inlineCode', 'math', 'inlineMath'])

function walk(parent: Parent): void {
  const next: Parent['children'] = []
  let changed = false
  for (const child of parent.children) {
    if (child.type === 'text') {
      const parts = splitText(child)
      if (parts) {
        next.push(...parts)
        changed = true
        continue
      }
    } else if ('children' in child && !SKIP.has(child.type)) {
      walk(child)
    }
    next.push(child)
  }
  if (changed) parent.children = next
}

/** remark plugin: turns inline "[p. N]" citations into citation nodes. */
export function remarkCitations() {
  return (tree: Root): void => {
    walk(tree)
  }
}
