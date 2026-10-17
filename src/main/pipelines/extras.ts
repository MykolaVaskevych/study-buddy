import type { Card, CheatSheet, CheatSheetSection, Concept, DocId, Formula, PageNotes } from '@shared/domain'
import { leafTopics, requireDoc } from './scope'
import type { Handlers, PipelineDeps } from './types'

const MAX_CONCEPTS = 8
const MAX_FORMULAS = 8
const MAX_FACTS = 4

/** Core first, then supporting; details never make the one-page sheet. */
function pick<T extends { importance: string }>(items: T[], max: number, key: (t: T) => string): T[] {
  const seen = new Set<string>()
  const ordered = [
    ...items.filter((i) => i.importance === 'core'),
    ...items.filter((i) => i.importance === 'supporting')
  ]
  return ordered.filter((i) => !seen.has(key(i)) && seen.add(key(i))).slice(0, max)
}

export function buildSection(
  base: Omit<CheatSheetSection, 'concepts' | 'formulas' | 'keyFacts'>,
  notes: PageNotes[]
): CheatSheetSection {
  const teachable = notes.filter((n) => n.teachable)
  return {
    ...base,
    concepts: pick<Concept>(
      teachable.flatMap((n) => n.concepts),
      MAX_CONCEPTS,
      (c) => c.term.toLowerCase()
    ),
    formulas: pick<Formula>(
      teachable.flatMap((n) => n.formulas),
      MAX_FORMULAS,
      (f) => f.latex.replace(/\s+/g, '')
    ),
    keyFacts: teachable.flatMap((n) => n.keyPoints.slice(0, 1)).slice(0, MAX_FACTS)
  }
}

/** Markdown with $math$ → the HTML + MathJax delimiters Anki expects. */
export function toAnkiHtml(markdown: string): string {
  return markdown
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\$\$([\s\S]+?)\$\$/g, (_m, tex: string) => `\\[${tex}\\]`)
    .replace(/\$([^$\n]+?)\$/g, (_m, tex: string) => `\\(${tex}\\)`)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\t/g, ' ')
    .replace(/\r?\n/g, '<br>')
}

/** Anki 2.1.55+ text import: header lines pick the separator, note type, deck and tags columns. */
export function ankiFile(cards: readonly Card[], deckOf: (docId: DocId) => string): string {
  const rows = cards.map((c) => {
    const tags = [`p${c.sourcePages[0] ?? 0}`, c.essential ? 'essential' : '', c.type]
      .filter(Boolean)
      .join(' ')
    const deck = deckOf(c.docId).replace(/\t/g, ' ')
    return c.type === 'cloze'
      ? ['Cloze', deck, toAnkiHtml(c.front), toAnkiHtml(c.back), tags].join('\t')
      : ['Basic', deck, toAnkiHtml(c.front), toAnkiHtml(c.back), tags].join('\t')
  })
  return (
    ['#separator:tab', '#html:true', '#notetype column:1', '#deck column:2', '#tags column:5', ...rows].join(
      '\n'
    ) + '\n'
  )
}

/** Cheat sheet (from the index, no AI) and Anki export. */
export function createExtras(deps: Pick<PipelineDeps, 'db'>): {
  handlers: Pick<Handlers, 'library.cheatSheet' | 'cards.exportAnki'>
} {
  const { db } = deps
  return {
    handlers: {
      async 'library.cheatSheet'({ docId }): Promise<CheatSheet> {
        const doc = requireDoc(db, docId)
        const leaves = leafTopics(db.topics.list(docId))
        const ranges =
          leaves.length > 0
            ? leaves.map((t) => ({
                topicId: t.id,
                title: t.title,
                pageStart: t.pageStart,
                pageEnd: t.pageEnd
              }))
            : [{ topicId: null, title: doc.title, pageStart: 1, pageEnd: doc.pageCount }]
        const sections = ranges
          .map((r) => buildSection(r, db.pages.notesInRange(docId, r.pageStart, r.pageEnd)))
          .filter((s) => s.concepts.length + s.formulas.length + s.keyFacts.length > 0)
        return { docId, title: doc.title, sections }
      },

      async 'cards.exportAnki'({ docId }) {
        const docs = docId === null ? db.documents.list() : [requireDoc(db, docId)]
        const cards = docs.flatMap((d) => db.cards.list({ kind: 'document', docId: d.id }, false))
        const titles = new Map(docs.map((d) => [d.id, d.title]))
        const name = docId === null ? 'study-buddy' : (titles.get(docId) ?? 'study-buddy')
        return {
          fileName: `${name.replace(/[^\w\- ]+/g, '').trim() || 'study-buddy'}-anki.txt`,
          content: ankiFile(cards, (id) => `Study Buddy::${titles.get(id) ?? 'Cards'}`),
          count: cards.length
        }
      }
    }
  }
}
