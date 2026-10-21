import { basename } from 'node:path'
import type { DocId, DocumentDetail, DocumentSummary } from '@shared/domain'
import { placeImported } from './courses'
import type { Indexing } from './indexing'
import { messageOf, notFound } from './errors'
import { JOB_SCAN_LIMIT, ACTIVE_JOB_STATES } from './priorities'
import { requireDoc, type DocRecord } from './scope'
import type { Handlers, PipelineDeps } from './types'
import { ServiceError } from './types'
import { LibraryError } from '../library/types'

type LibraryChannels =
  | 'library.list'
  | 'library.import'
  | 'library.get'
  | 'library.rename'
  | 'library.delete'
  | 'library.setLastPage'
  | 'library.search'
  | 'library.pageNotes'

/** The summary part of a stored document (without hash, path, outline and language). */
export function toSummary(doc: DocRecord): DocumentSummary {
  return {
    id: doc.id,
    title: doc.title,
    pageCount: doc.pageCount,
    importedAt: doc.importedAt,
    lastOpenedAt: doc.lastOpenedAt,
    lastPage: doc.lastPage,
    index: doc.index,
    cardsDue: doc.cardsDue,
    mastery: doc.mastery,
    examDate: doc.examDate
  }
}

function toDetail(doc: DocRecord): DocumentDetail {
  return { ...toSummary(doc), outline: doc.outline, language: doc.language }
}

/**
 * Library: import (instant, no AI) → persist pages and chunk grid → start the index pass. Delete
 * cancels the document's jobs before removing its rows and files.
 */
export function createLibraryService(
  deps: Pick<PipelineDeps, 'db' | 'library' | 'queue' | 'emit' | 'pickPdfs' | 'now'>,
  services: { indexing: Indexing }
): { handlers: Pick<Handlers, LibraryChannels> } {
  const { db, library } = deps

  async function importOne(path: string): Promise<{ id: DocId; created: boolean }> {
    const pdf = await library.importPdf(path)
    const { id: docId, created } = db.transaction(() => {
      const { id, created } = db.documents.upsert({
        sha256: pdf.sha256,
        title: pdf.title,
        storedPath: pdf.storedPath,
        pageCount: pdf.pageCount,
        outline: pdf.outline
      })
      if (created) db.pages.insertPages(id, pdf.pages)
      // Also on re-import: chunk paths follow the library if it moved.
      db.pages.setChunks(id, pdf.chunks)
      return { id, created }
    })
    try {
      await services.indexing.start(docId, { auto: true })
    } catch (err) {
      // The document is imported either way; indexing can be started again from the UI.
      console.warn(`[pipelines] could not start indexing ${docId}: ${messageOf(err)}`)
    }
    deps.emit('library.changed', { docId })
    return { id: docId, created }
  }

  return {
    handlers: {
      'library.list': async () => db.documents.list(),

      'library.import': async ({ paths, courseId }) => {
        const files = paths ?? (await deps.pickPdfs())
        const imported: { id: DocId; created: boolean }[] = []
        const failures: string[] = []
        for (const path of files) {
          try {
            imported.push(await importOne(path))
          } catch (err) {
            if (!(err instanceof LibraryError)) throw err
            failures.push(`${basename(path)}: ${err.message}`)
          }
        }
        if (imported.length > 0) {
          placeImported(db, imported, {
            courseId: courseId ?? null,
            paths: files,
            now: deps.now().toISOString()
          })
          deps.emit('library.changed', { docId: null })
        }
        // Successful files stay imported (library.changed already told the UI); the error names the rest.
        if (failures.length > 0) {
          const done = imported.length > 0 ? ` (${imported.length} other file(s) imported)` : ''
          throw new ServiceError('validation', `Could not import ${failures.join('; ')}${done}`)
        }
        return [...new Set(imported.map((d) => d.id))].map((id) => toSummary(requireDoc(db, id)))
      },

      'library.get': async ({ docId }) => toDetail(requireDoc(db, docId)),

      'library.rename': async ({ docId, title }) => {
        requireDoc(db, docId)
        db.documents.rename(docId, title.trim())
        deps.emit('library.changed', { docId })
        return toSummary(requireDoc(db, docId))
      },

      'library.delete': async ({ docId }) => {
        const doc = requireDoc(db, docId)
        for (const job of db.jobs.list(docId, JOB_SCAN_LIMIT)) {
          if (ACTIVE_JOB_STATES.has(job.state)) deps.queue.cancel(job.id)
        }
        // Rows first (jobs, pages, cards... cascade), so the UI never lists a document without files.
        db.documents.delete(docId)
        try {
          await library.deleteFiles(doc.sha256)
        } catch (err) {
          // Orphaned files are harmless; a re-import of the same PDF reuses or replaces them.
          console.warn(`[pipelines] could not delete files of ${docId}: ${messageOf(err)}`)
        }
        deps.emit('library.changed', { docId })
        return { deleted: true }
      },

      'library.setLastPage': async ({ docId, page }) => {
        requireDoc(db, docId)
        db.documents.setLastPage(docId, page)
        return { ok: true }
      },

      'library.search': async ({ query, docId, limit }) => db.pages.search(query, docId, limit),

      'library.pageNotes': async ({ docId, page }) => {
        const notes = db.pages.notes(docId, page)
        if (!notes) throw notFound('Page', `${docId}#${page}`)
        return notes
      }
    }
  }
}
