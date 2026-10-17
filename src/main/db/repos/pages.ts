import { and, asc, between, eq, isNotNull } from 'drizzle-orm'
import type { DocId, PageNotes, SearchHit } from '@shared/domain'
import { clampLimit, iso, NotFoundError, type RepoContext } from '../context'
import { toFtsQuery } from '../fts'
import { chunks, pages } from '../schema'
import type { PageRepo } from '../types'

type PageRow = typeof pages.$inferSelect

const SEARCH_MAX_LIMIT = 100
/** Tokens of context around the match in a search snippet. */
const SNIPPET_TOKENS = 16

/** Unindexed pages report `indexed=false` with empty fields, whatever stale data the row may hold. */
function toNotes(row: PageRow): PageNotes {
  const indexed = row.indexedAt !== null
  return {
    docId: row.docId,
    page: row.page,
    label: row.label,
    indexed,
    kind: indexed ? row.kind : null,
    teachable: indexed ? row.teachable : false,
    summary: indexed ? row.summary : null,
    keyPoints: indexed ? row.keyPoints : [],
    concepts: indexed ? row.concepts : [],
    formulas: indexed ? row.formulas : [],
    exercises: indexed ? row.exercises : [],
    examSignals: indexed ? row.examSignals : []
  }
}

interface FtsRow {
  docId: string
  page: number
  snippet: string
  rank: number
}

export function createPageRepo(ctx: RepoContext): PageRepo {
  const { db, sqlite } = ctx

  // bm25 weights follow the FTS column order (doc_id, page, text, summary, key_points). The AI
  // summary and key points are dense, so a hit there says more than one in the raw page text.
  // bm25() is "lower is better"; it is negated so SearchHit.score is "higher is better".
  const searchSql = (withDoc: boolean): string => `
    select doc_id as docId, page, snippet(pages_fts, -1, '', '', '…', ${SNIPPET_TOKENS}) as snippet,
           bm25(pages_fts, 0, 0, 1.0, 2.0, 2.0) as rank
    from pages_fts
    where pages_fts match ? ${withDoc ? 'and doc_id = ?' : ''}
    order by rank
    limit ?`
  const searchAll = sqlite.prepare<[string, number], FtsRow>(searchSql(false))
  const searchDoc = sqlite.prepare<[string, string, number], FtsRow>(searchSql(true))

  const pageWhere = (docId: DocId, page: number) => and(eq(pages.docId, docId), eq(pages.page, page))

  return {
    insertPages(docId, newPages) {
      // Upsert: re-importing keeps the AI index data. FTS rows follow via the pages_fts_* triggers.
      ctx.tx(() => {
        for (const p of newPages) {
          const values = {
            label: p.label,
            text: p.text,
            charCount: p.charCount,
            hasTextLayer: p.hasTextLayer
          }
          db.insert(pages)
            .values({ docId, page: p.page, ...values })
            .onConflictDoUpdate({ target: [pages.docId, pages.page], set: values })
            .run()
        }
      })
    },

    setChunks(docId, rows) {
      ctx.tx(() => {
        db.delete(chunks).where(eq(chunks.docId, docId)).run()
        for (const c of rows)
          db.insert(chunks)
            .values({ docId, ...c })
            .run()
      })
    },

    chunks(docId) {
      return db
        .select({
          index: chunks.index,
          startPage: chunks.startPage,
          endPage: chunks.endPage,
          path: chunks.path,
          bytes: chunks.bytes
        })
        .from(chunks)
        .where(eq(chunks.docId, docId))
        .orderBy(asc(chunks.index))
        .all()
    },

    text(docId, page) {
      return db.select({ text: pages.text }).from(pages).where(pageWhere(docId, page)).get()?.text ?? ''
    },

    notes(docId, page) {
      const row = db.select().from(pages).where(pageWhere(docId, page)).get()
      return row ? toNotes(row) : null
    },

    notesInRange(docId, from, to) {
      return db
        .select()
        .from(pages)
        .where(and(eq(pages.docId, docId), between(pages.page, Math.min(from, to), Math.max(from, to))))
        .orderBy(asc(pages.page))
        .all()
        .map(toNotes)
    },

    saveIndex(docId, page, update) {
      const result = db
        .update(pages)
        .set({
          kind: update.kind,
          teachable: update.teachable,
          summary: update.summary,
          keyPoints: update.keyPoints,
          concepts: update.concepts,
          formulas: update.formulas,
          exercises: update.exercises,
          examSignals: update.examSignals,
          indexedAt: iso(ctx.now())
        })
        .where(pageWhere(docId, page))
        .run()
      if (result.changes === 0) throw new NotFoundError('Page', `${docId}#${page}`)
    },

    indexedPages(docId) {
      return db
        .select({ page: pages.page })
        .from(pages)
        .where(and(eq(pages.docId, docId), isNotNull(pages.indexedAt)))
        .orderBy(asc(pages.page))
        .all()
        .map((r) => r.page)
    },

    search(query, docId, limit): SearchHit[] {
      const match = toFtsQuery(query)
      const n = clampLimit(limit, SEARCH_MAX_LIMIT)
      if (match === null || n === 0) return []
      try {
        const rows = docId === null ? searchAll.all(match, n) : searchDoc.all(match, docId, n)
        return rows.map((r) => ({ docId: r.docId, page: r.page, snippet: r.snippet, score: -r.rank }))
      } catch (err) {
        // toFtsQuery only emits quoted phrases, so this is not expected; a search box must still never
        // surface an SQL error to the user.
        console.warn('[db] search failed', { query, err })
        return []
      }
    }
  }
}
