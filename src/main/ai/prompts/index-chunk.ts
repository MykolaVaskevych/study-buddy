import type { ChunkInfo } from '../../library/types'
import type { PageTextLookup } from '../types'
import { CORE_PRINCIPLES, FOCUS_PAGES_KEY, PDF_PRINCIPLES, formatRange, headerLines } from './common'
import { formatManifest, manifestEntries } from './manifest'

/** Index pass over one chunk (fast tier). Produces page notes and the digest for the topic map. */

export const INDEX_SYSTEM = `${CORE_PRINCIPLES}

${PDF_PRINCIPLES}

Your task: index every page of the attached chunk for a study app. Output exactly one entry per page in the page manifest, in page order.

For each page:
- page: the SB-PAGE number.
- kind: title | toc | content | exercise | answers | references | blank | other ("other" for administrative pages such as schedules, grading rules or contact details).
- teachable: true if a student should learn from the page; false for title, table of contents, blank, references and administrative pages.
- summary: 1-3 sentences stating what the page teaches (the content itself, not "this slide shows"). For a non-teachable page, a few words saying what it is.
- key_points: up to 6 short, self-contained statements a student must remember.
- concepts: terms the page defines or relies on centrally, each with a one-sentence definition based on the page. importance: core (foundational or clearly exam-relevant), supporting, or detail.
- formulas: every meaningful formula as LaTeX WITHOUT $ delimiters, its meaning in one sentence, a symbol table (unit null when unitless or not given) and importance.
- exercises: questions or tasks printed on the page, with the answer when the page gives it (otherwise null).
- exam_signals: quiz_slide (an in-lecture quiz or test question), exam_trap ("common mistake", "watch out"), practice_exam (a past or sample exam question), formula_sheet, worked_example (a step-by-step solution), slide_correction (an erratum), emphasis ("important", "exam relevant", boxed or highlighted content). Empty when none apply.

language: the ISO 639-1 code of the document's language (e.g. "en", "de", "uk").
Write summaries, key points and definitions in the document's language. Keep it factual and compact.`

/** Opening text per page in the manifest; enough to confirm the page, cheap in tokens. */
export const INDEX_SNIPPET_CHARS = 160

export function buildIndexUser(chunk: ChunkInfo, pageText: PageTextLookup): string {
  const manifest = manifestEntries(chunk.startPage, chunk.endPage, pageText, INDEX_SNIPPET_CHARS)
  return [
    headerLines({ Task: 'index', [FOCUS_PAGES_KEY]: formatRange(chunk.startPage, chunk.endPage) }),
    formatManifest(manifest),
    `Index all ${manifest.length} pages (SB-PAGE ${chunk.startPage} to ${chunk.endPage}).`
  ].join('\n\n')
}
