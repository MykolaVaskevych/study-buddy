import type { IndexedPage } from '../types'
import { pageLabel } from './common'

/**
 * Index notes as compact text for generation prompts. They tell the model what the index pass
 * judged core on each page, so generated items concentrate on what matters; the PDF pages stay
 * the source of truth. Long fields are truncated to keep the prompt small.
 */

const MAX_FIELD = 300

function short(text: string, max = MAX_FIELD): string {
  const collapsed = text.replace(/\s+/g, ' ').trim()
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1).trimEnd()}…`
}

/** Text header of one page's notes block; the fake provider splits notes on it. */
export function notesPageHeader(page: IndexedPage): string {
  return `${pageLabel(page.page)} [${page.kind}${page.teachable ? '' : ', not teachable'}]`
}

export function formatNotes(notes: readonly IndexedPage[]): string {
  if (notes.length === 0) return 'Index notes: none yet (rely on the pages).'
  const blocks = [...notes]
    .sort((a, b) => a.page - b.page)
    .map((p) => {
      const lines = [notesPageHeader(p), `Summary: ${short(p.summary)}`]
      if (p.keyPoints.length > 0)
        lines.push(`Key points: ${p.keyPoints.map((k) => short(k, 160)).join(' | ')}`)
      if (p.concepts.length > 0)
        lines.push(
          `Concepts: ${p.concepts.map((c) => `${c.term} (${c.importance}): ${short(c.definition, 160)}`).join(' | ')}`
        )
      if (p.formulas.length > 0)
        lines.push(
          `Formulas: ${p.formulas.map((f) => `$${f.latex}$ (${f.importance}): ${short(f.meaning, 120)}`).join(' | ')}`
        )
      if (p.exercises.length > 0)
        lines.push(
          `Exercises: ${p.exercises.map((e) => `${short(e.question, 160)} -> ${e.answer === null ? 'no answer given' : short(e.answer, 120)}`).join(' | ')}`
        )
      if (p.examSignals.length > 0) lines.push(`Exam signals: ${p.examSignals.join(', ')}`)
      return lines.join('\n')
    })
  return ['Index notes (from a first pass over these pages):', ...blocks].join('\n\n')
}
