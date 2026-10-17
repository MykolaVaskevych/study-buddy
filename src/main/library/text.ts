/**
 * Pure text helpers for PDF extraction: joining pdf.js text runs, whitespace normalisation, text-layer
 * detection and title selection. Kept free of pdf.js so the rules are unit-tested on plain data.
 */

/** A pdf.js text item reduced to what joining needs. Coordinates are PDF user space. */
export interface TextRun {
  str: string
  hasEOL: boolean
  /** Baseline origin. */
  x: number
  y: number
  /** Advance width and font height of the run. */
  width: number
  height: number
  /** False for rotated or vertical text, where x/y gaps say nothing about word or line breaks. */
  horizontal: boolean
}

/** Pages with fewer non-space characters than this are treated as image-only (scans, diagram slides). */
export const TEXT_LAYER_MIN_CHARS = 40

/** Titles longer than this are body text, not a title. */
const MAX_TITLE_LENGTH = 200

/**
 * Separator between two consecutive non-empty runs on a page without an explicit EOL. pdf.js inserts
 * spaces itself in most cases, but runs that jump to another line (footers, stamps, table cells) or are
 * separated by a positioned gap often come without one, which would glue words together ("NetworksW2").
 */
export function separatorBetween(prev: TextRun, next: TextRun): '' | ' ' | '\n' {
  if (!prev.horizontal || !next.horizontal) return ''
  const lineHeight = Math.max(prev.height, next.height, 1)
  if (Math.abs(next.y - prev.y) > lineHeight * 0.5) return '\n'
  if (/\s$/.test(prev.str) || /^\s/.test(next.str)) return ''
  const gap = next.x - (prev.x + prev.width)
  // A backwards jump on the same baseline is overprinting or a new column: keep the words apart.
  if (gap < -lineHeight) return ' '
  return gap > lineHeight * 0.15 ? ' ' : ''
}

/** Joins pdf.js text runs into page text: `hasEOL` ends a line, geometry fills in missing breaks. */
export function joinTextRuns(runs: readonly TextRun[]): string {
  let out = ''
  let prev: TextRun | null = null
  let lineBreak = false
  for (const run of runs) {
    if (run.str.length > 0) {
      if (prev) out += lineBreak ? '\n' : separatorBetween(prev, run)
      out += run.str
      prev = run
      lineBreak = false
    }
    if (run.hasEOL && prev) lineBreak = true
  }
  return out
}

/**
 * Whitespace-normalised text: one space between words, one newline between lines, no blank lines.
 * Line breaks are kept because they carry structure (titles, bullets) for search snippets and titles.
 * Control and zero-width characters, which some PDF generators leak into text, are removed.
 */
export function normaliseText(raw: string): string {
  return (
    raw
      .replace(/\r\n?/g, '\n')
      .replace(/[\u200B-\u200D\u2060\uFEFF\u00AD]/g, '')
      // eslint-disable-next-line no-control-regex -- stripping control characters is the point here
      .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+/g, ' ').trim())
      .filter((line) => line.length > 0)
      .join('\n')
  )
}

/** Number of non-whitespace characters. */
export function countNonSpace(text: string): number {
  return text.replace(/\s/g, '').length
}

/** True when a page has a real text layer rather than a few stray characters (e.g. only a page number). */
export function hasTextLayer(text: string): boolean {
  return countNonSpace(text) >= TEXT_LAYER_MIN_CHARS
}

const APP_PREFIX = /^(?:microsoft\s+)?(?:word|powerpoint|excel)\s*-\s*/i
const FILE_LIKE = /\.(?:pdf|docx?|pptx?|xlsx?|odt|odp|rtf|txt|tex|dvi|ps|eps|indd|key|pages)$/i
const PATH_LIKE = /^(?:[a-z]:[\\/]|\/|~\/)/i
const PLACEHOLDER =
  /^(?:untitled(?:\s+document)?|no\s+title|title|presentation\s*\d*|powerpoint\s+presentation|slide\s*\d*|document\s*\d*|doc\d*|unknown|none|null|n\/a|default)$/i

/**
 * Returns a cleaned title, or null when the candidate is not a meaningful title: empty, a placeholder
 * written by an authoring tool ("Untitled", "Presentation1"), a file name or path ("lecture3.pptx"),
 * mostly digits (a page number), or too long to be a title.
 */
export function cleanTitle(candidate: string | null | undefined): string | null {
  if (typeof candidate !== 'string') return null
  const title = normaliseText(candidate).replace(/\n/g, ' ').replace(APP_PREFIX, '').trim()
  if (title.length === 0 || title.length > MAX_TITLE_LENGTH) return null
  if (FILE_LIKE.test(title) || PATH_LIKE.test(title) || PLACEHOLDER.test(title)) return null
  const letters = title.match(/\p{L}/gu)?.length ?? 0
  return letters >= 2 ? title : null
}

/** First line of a page's text that passes {@link cleanTitle}. */
export function firstMeaningfulLine(text: string): string | null {
  for (const line of text.split('\n')) {
    const title = cleanTitle(line)
    if (title) return title
  }
  return null
}

/** File name without directory and extension, the last-resort title. */
export function fileStem(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? fileName
  const stem = base.replace(/\.[^.]+$/, '').trim()
  return stem.length > 0 ? stem : base
}

export interface TitleSources {
  /** Metadata candidates in order of preference (XMP dc:title, then the Info dictionary Title). */
  metadata: readonly (string | null | undefined)[]
  /** Normalised text of page 1. */
  firstPageText: string
  /** Original file name, used when nothing better exists. */
  fileName: string
}

/** Picks the document title: meaningful metadata, else the first meaningful line of page 1, else the file name. */
export function chooseTitle(sources: TitleSources): string {
  for (const candidate of sources.metadata) {
    const title = cleanTitle(candidate)
    if (title) return title
  }
  return firstMeaningfulLine(sources.firstPageText) ?? fileStem(sources.fileName)
}
