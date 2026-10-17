import { desc, eq, sql } from 'drizzle-orm'
import type { DocId, DocumentSummary, IndexState, OutlineItem } from '@shared/domain'
import { iso, type RepoContext } from '../context'
import { documents } from '../schema'
import type { DocumentRepo } from '../types'

type DocumentRow = typeof documents.$inferSelect

/**
 * Selection shared by get() and list(): the document row plus the per-document aggregates the
 * library screen shows. Correlated subqueries keep it one round trip without GROUP BY fan-out.
 * The outer column is written as literal `documents.id`: drizzle renders `${documents.id}` unqualified
 * in single-table selects, which inside the subquery would bind to the inner table's `id`.
 */
function summarySelection(nowIso: string) {
  return {
    doc: documents,
    indexedPages: sql<number>`(select count(*) from pages p where p.doc_id = documents.id and p.indexed_at is not null)`,
    cardsDue: sql<number>`(select count(*) from cards c where c.doc_id = documents.id and c.status = 'active' and c.due <= ${nowIso})`,
    // Mean of each topic's Beta mean, over topics that have evidence.
    mastery: sql<
      number | null
    >`(select avg(t.mastery_alpha / (t.mastery_alpha + t.mastery_beta)) from topics t where t.doc_id = documents.id and t.mastery_alpha is not null and t.mastery_beta is not null)`,
    examDate: sql<
      string | null
    >`(select json_extract(pl.input, '$.examDate') from plans pl where pl.doc_id = documents.id)`
  }
}

interface SummaryRow {
  doc: DocumentRow
  indexedPages: number
  cardsDue: number
  mastery: number | null
  examDate: string | null
}

function toSummary(row: SummaryRow): DocumentSummary {
  const { doc } = row
  return {
    id: doc.id,
    title: doc.title,
    pageCount: doc.pageCount,
    importedAt: doc.importedAt,
    lastOpenedAt: doc.lastOpenedAt,
    lastPage: doc.lastPage,
    index: {
      state: doc.indexState,
      indexedPages: row.indexedPages,
      totalPages: doc.pageCount,
      ...(doc.indexError !== null ? { error: doc.indexError } : {})
    },
    cardsDue: row.cardsDue,
    mastery: row.mastery,
    examDate: typeof row.examDate === 'string' ? row.examDate : null
  }
}

export function createDocumentRepo(ctx: RepoContext): DocumentRepo {
  const { db } = ctx

  const touch = (docId: DocId, set: Partial<typeof documents.$inferInsert>): void => {
    db.update(documents).set(set).where(eq(documents.id, docId)).run()
  }

  return {
    upsert(doc) {
      return ctx.tx(() => {
        const existing = db
          .select({ id: documents.id })
          .from(documents)
          .where(eq(documents.sha256, doc.sha256))
          .get()
        if (existing) return { id: existing.id, created: false }
        const id = ctx.newId()
        db.insert(documents)
          .values({
            id,
            sha256: doc.sha256,
            title: doc.title,
            storedPath: doc.storedPath,
            pageCount: doc.pageCount,
            outline: doc.outline,
            importedAt: iso(ctx.now())
          })
          .run()
        return { id, created: true }
      })
    },

    get(docId) {
      const row = db
        .select(summarySelection(iso(ctx.now())))
        .from(documents)
        .where(eq(documents.id, docId))
        .get()
      if (!row) return null
      const outline: OutlineItem[] = row.doc.outline
      return {
        ...toSummary(row),
        sha256: row.doc.sha256,
        storedPath: row.doc.storedPath,
        outline,
        language: row.doc.language
      }
    },

    list() {
      return db
        .select(summarySelection(iso(ctx.now())))
        .from(documents)
        .orderBy(
          sql`${documents.lastOpenedAt} is null`,
          desc(documents.lastOpenedAt),
          desc(documents.importedAt)
        )
        .all()
        .map(toSummary)
    },

    rename(docId, title) {
      touch(docId, { title })
    },

    setLastPage(docId, page) {
      // Opening a page is what "last opened" means for the library ordering.
      touch(docId, { lastPage: Math.max(1, Math.floor(page)), lastOpenedAt: iso(ctx.now()) })
    },

    setLanguage(docId, language) {
      touch(docId, { language })
    },

    setIndexState(docId: DocId, state: IndexState, error?: string | null) {
      touch(docId, { indexState: state, indexError: error ?? null })
    },

    delete(docId) {
      // Pages, FTS rows (via trigger), topics, cards, questions, quizzes, plans and jobs cascade.
      db.delete(documents).where(eq(documents.id, docId)).run()
    }
  }
}
