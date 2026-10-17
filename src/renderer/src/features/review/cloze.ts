/**
 * Cloze deletions in card text: `{{c1::answer}}` or `{{c1::answer::hint}}` (Anki syntax).
 * Answers may contain LaTeX with braces, e.g. `{{c1::$\lambda^{-4}$}}`, so gaps are found by
 * scanning with brace depth rather than with a regex.
 */

export type ClozeSegment =
  { kind: 'text'; text: string } | { kind: 'gap'; n: number; answer: string; hint: string | null }

const OPEN = /^\{\{c(\d+)::/

/** Index of the "}}" closing a gap body that starts at `from`, or -1. */
function closeOf(text: string, from: number): number {
  let depth = 0
  for (let i = from; i < text.length; i++) {
    const ch = text[i]
    if (ch === '\\') {
      i++ // escaped character, e.g. \{ in LaTeX
    } else if (ch === '{') {
      depth++
    } else if (ch === '}') {
      if (depth === 0 && text[i + 1] === '}') return i
      if (depth > 0) depth--
    }
  }
  return -1
}

/** Splits "answer::hint" on the first top-level "::". */
function splitHint(body: string): { answer: string; hint: string | null } {
  let depth = 0
  for (let i = 0; i < body.length - 1; i++) {
    const ch = body[i]
    if (ch === '\\') i++
    else if (ch === '{') depth++
    else if (ch === '}') depth = Math.max(0, depth - 1)
    else if (depth === 0 && ch === ':' && body[i + 1] === ':') {
      const hint = body.slice(i + 2).trim()
      return { answer: body.slice(0, i), hint: hint || null }
    }
  }
  return { answer: body, hint: null }
}

/** Parses card text into plain text and gaps. Unterminated markers stay plain text. */
export function parseCloze(text: string): ClozeSegment[] {
  const out: ClozeSegment[] = []
  let cursor = 0
  let search = 0
  while (search < text.length) {
    const open = text.indexOf('{{c', search)
    if (open < 0) break
    const m = OPEN.exec(text.slice(open))
    if (!m?.[1]) {
      search = open + 3
      continue
    }
    const bodyStart = open + m[0].length
    const close = closeOf(text, bodyStart)
    if (close < 0) break
    if (open > cursor) out.push({ kind: 'text', text: text.slice(cursor, open) })
    out.push({ kind: 'gap', n: Number(m[1]), ...splitHint(text.slice(bodyStart, close)) })
    cursor = search = close + 2
  }
  if (cursor < text.length) out.push({ kind: 'text', text: text.slice(cursor) })
  return out
}

export function hasCloze(text: string): boolean {
  return parseCloze(text).some((s) => s.kind === 'gap')
}

/** Plain-text rendering for previews and labels: gaps as "[…]" (or "[hint]") or as the answer. */
export function clozePlain(text: string, reveal: boolean): string {
  return parseCloze(text)
    .map((s) => (s.kind === 'text' ? s.text : reveal ? s.answer : `[${s.hint ?? '…'}]`))
    .join('')
}
