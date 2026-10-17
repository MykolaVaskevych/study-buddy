import type { Concept, ExamSignal, Exercise, Formula, PageKind } from '@shared/domain'
import type { IndexedPageOutput } from '@shared/ai/schemas'
import type { IndexedPage } from '../types'
import { cleanStrings } from './text'

/**
 * Post-processing of the index pass. The schema cannot express page ranges or array sizes
 * (structured outputs reject numeric/length constraints), so they are enforced here.
 */

/** Upper bounds that keep page notes readable and the topic-map digest small. */
export const INDEX_LIMITS = {
  summaryChars: 1200,
  keyPoints: 8,
  concepts: 12,
  formulas: 10,
  symbols: 12,
  exercises: 10
} as const

/** Page kinds that never produce study items, whatever the model said. */
const NOT_TEACHABLE: ReadonlySet<PageKind> = new Set(['title', 'toc', 'blank', 'references'])

/** Removes surrounding math delimiters: the domain stores formulas as bare LaTeX. */
export function stripMathDelimiters(latex: string): string {
  const trimmed = latex.trim()
  const wrapped = /^\$\$?([\s\S]*?)\$?\$$|^\\\(([\s\S]*)\\\)$|^\\\[([\s\S]*)\\\]$/.exec(trimmed)
  if (!wrapped) return trimmed
  return (wrapped[1] ?? wrapped[2] ?? wrapped[3] ?? '').trim()
}

function truncate(text: string, max: number): string {
  const trimmed = text.trim()
  return trimmed.length <= max ? trimmed : `${trimmed.slice(0, max - 1).trimEnd()}…`
}

function cleanConcepts(raw: IndexedPageOutput['concepts']): Concept[] {
  const seen = new Set<string>()
  const out: Concept[] = []
  for (const c of raw) {
    const term = c.term.trim()
    const key = term.toLowerCase()
    if (term === '' || seen.has(key)) continue
    seen.add(key)
    out.push({ term, definition: c.definition.trim(), importance: c.importance })
    if (out.length >= INDEX_LIMITS.concepts) break
  }
  return out
}

function cleanFormulas(raw: IndexedPageOutput['formulas']): Formula[] {
  const out: Formula[] = []
  for (const f of raw) {
    const latex = stripMathDelimiters(f.latex)
    if (latex === '') continue
    out.push({
      latex,
      meaning: f.meaning.trim(),
      symbols: f.symbols
        .filter((s) => s.symbol.trim() !== '')
        .slice(0, INDEX_LIMITS.symbols)
        .map((s) => ({
          symbol: s.symbol.trim(),
          meaning: s.meaning.trim(),
          unit: s.unit === null || s.unit.trim() === '' ? null : s.unit.trim()
        })),
      importance: f.importance
    })
    if (out.length >= INDEX_LIMITS.formulas) break
  }
  return out
}

function cleanExercises(raw: IndexedPageOutput['exercises']): Exercise[] {
  return raw
    .filter((e) => e.question.trim() !== '')
    .slice(0, INDEX_LIMITS.exercises)
    .map((e) => ({
      question: e.question.trim(),
      answer: e.answer === null || e.answer.trim() === '' ? null : e.answer.trim()
    }))
}

/** Converts and cleans one page entry (the page number is assumed valid). */
export function toIndexedPage(raw: IndexedPageOutput): IndexedPage {
  return {
    page: raw.page,
    kind: raw.kind,
    teachable: raw.teachable && !NOT_TEACHABLE.has(raw.kind),
    summary: truncate(raw.summary, INDEX_LIMITS.summaryChars),
    keyPoints: cleanStrings(raw.key_points, INDEX_LIMITS.keyPoints),
    concepts: cleanConcepts(raw.concepts),
    formulas: cleanFormulas(raw.formulas),
    exercises: cleanExercises(raw.exercises),
    examSignals: [...new Set<ExamSignal>(raw.exam_signals)]
  }
}

/** Rough amount of content, used to pick the better entry when the model repeats a page. */
function richness(page: IndexedPage): number {
  return (
    page.summary.length +
    40 * (page.keyPoints.length + page.concepts.length + page.formulas.length + page.exercises.length)
  )
}

/**
 * Keeps entries for integer pages inside [startPage, endPage], one per page (the richest when the
 * model repeats a page), sorted by page, and lists the pages of the range the model skipped.
 */
export function normalizeIndexedPages(
  raw: readonly IndexedPageOutput[],
  startPage: number,
  endPage: number
): { pages: IndexedPage[]; missingPages: number[] } {
  const byPage = new Map<number, IndexedPage>()
  for (const entry of raw) {
    if (!Number.isInteger(entry.page) || entry.page < startPage || entry.page > endPage) continue
    const page = toIndexedPage(entry)
    const previous = byPage.get(page.page)
    if (!previous || richness(page) > richness(previous)) byPage.set(page.page, page)
  }
  const pages = [...byPage.values()].sort((a, b) => a.page - b.page)
  const missingPages: number[] = []
  for (let p = startPage; p <= endPage; p++) if (!byPage.has(p)) missingPages.push(p)
  return { pages, missingPages }
}

/** ISO 639-1 code from the model's answer ("en", "EN", "en-US"); 'und' when it is not one. */
export function normalizeLanguage(raw: string): string {
  const match = /^([a-z]{2})(?:$|[-_\s])/.exec(raw.trim().toLowerCase())
  return match?.[1] ?? 'und'
}
