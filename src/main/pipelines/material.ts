import { stat } from 'node:fs/promises'
import type { PageNotes } from '@shared/domain'
import type { GenerationContext, IndexedPage, PageTextLookup } from '../ai/types'
import type { ChunkInfo } from '../library/types'
import {
  coveringChunks,
  focusChunkRange,
  leafTopics,
  leavesUnder,
  pagesIn,
  planWindows,
  type DocRecord,
  type PageRange,
  type ResolvedScope
} from './scope'
import type { PipelineDeps } from './types'

/**
 * Builds what a generation call reads: the PDF pages (grid chunks, or a focus chunk for small
 * ranges), the index notes, the page-text lookup for grounding, and the output language.
 */
export interface Material {
  /** The document's chunk grid; rebuilt (files and rows) when a chunk in `range` is missing or damaged. */
  grid(doc: DocRecord, range?: PageRange): Promise<ChunkInfo[]>
  /**
   * Page windows for generating over a scope, each fitting one request. `byTopic` (document scope)
   * yields one window per leaf topic.
   */
  windows(scope: ResolvedScope, byTopic: boolean): Promise<PageRange[]>
  /** Windows whose pages are all indexed and none teachable are dropped: nothing to generate from. */
  teachable(docId: string, windows: readonly PageRange[]): PageRange[]
  /** Generation context for one request focused on `range`. */
  context(doc: DocRecord, range: PageRange, signal?: AbortSignal): Promise<GenerationContext>
  /** Cached page-text lookup for one document. */
  pageText(docId: string): PageTextLookup
  /** Output language: the setting, or the document's own language for 'auto'. */
  language(doc: DocRecord): string
}

export interface MaterialOptions {
  /** Ranges up to this many pages are sent as a focus chunk (the pages ± 1). */
  focusMaxPages: number
  /** Most pages one generation request focuses on. */
  windowPages: number
  /** Most raw PDF bytes per request; the AI module refuses more (22 MB by default). */
  maxRequestBytes: number
}

/** Index notes in the AI's input shape. */
export function toIndexedPage(n: PageNotes): IndexedPage {
  return {
    page: n.page,
    kind: n.kind ?? 'other',
    teachable: n.teachable,
    summary: n.summary ?? '',
    keyPoints: n.keyPoints,
    concepts: n.concepts,
    formulas: n.formulas,
    exercises: n.exercises,
    examSignals: n.examSignals
  }
}

async function intact(chunk: ChunkInfo): Promise<boolean> {
  return stat(chunk.path).then(
    (s) => s.isFile() && s.size === chunk.bytes,
    () => false
  )
}

export function createMaterial(
  deps: Pick<PipelineDeps, 'db' | 'library'>,
  options: MaterialOptions
): Material {
  const { db, library } = deps

  const grid: Material['grid'] = async (doc, range) => {
    const rows = db.pages.chunks(doc.id)
    const needed = range ? coveringChunks(rows, range) : rows
    const ok = rows.length > 0 && (await Promise.all(needed.map(intact))).every(Boolean)
    if (ok) return rows
    // Library moved or files deleted: the library rebuilds from the stored PDF; rows follow its paths.
    const rebuilt = await library.ensureChunks(doc.sha256, doc.pageCount)
    db.pages.setChunks(doc.id, rebuilt)
    return rebuilt
  }

  const pageText: Material['pageText'] = (docId) => {
    const cache = new Map<number, string>()
    return (page) => {
      const hit = cache.get(page)
      if (hit !== undefined) return hit
      const text = db.pages.text(docId, page)
      cache.set(page, text)
      return text
    }
  }

  const language: Material['language'] = (doc) => {
    const setting = db.settings.get().contentLanguage.trim()
    return setting === '' || setting.toLowerCase() === 'auto' ? (doc.language ?? 'auto') : setting
  }

  return {
    grid,
    pageText,
    language,

    async windows(scope, byTopic) {
      const topics = db.topics.list(scope.doc.id)
      const leaves = scope.topic ? leavesUnder(topics, scope.topic.id) : leafTopics(topics)
      return planWindows(
        { from: scope.from, to: scope.to },
        {
          leaves,
          grid: await grid(scope.doc),
          byTopic,
          windowPages: options.windowPages,
          maxBytes: options.maxRequestBytes
        }
      )
    },

    teachable(docId, windows) {
      return windows.filter((w) => {
        const notes = db.pages.notesInRange(docId, w.from, w.to)
        // Unindexed pages may well be teachable: only a fully indexed, fully unteachable window is skipped.
        return notes.length < pagesIn(w) || notes.some((n) => !n.indexed || n.teachable)
      })
    },
    async context(doc, range, signal) {
      const context = { from: Math.max(1, range.from - 1), to: Math.min(doc.pageCount, range.to + 1) }
      const chunks = await grid(doc, context)
      const focus = focusChunkRange(range, doc.pageCount, chunks, options.focusMaxPages)
      return {
        chunks: focus
          ? [await library.buildFocusChunk(doc.sha256, doc.pageCount, focus.from, focus.to)]
          : coveringChunks(chunks, range),
        pageFrom: range.from,
        pageTo: range.to,
        notes: db.pages
          .notesInRange(doc.id, range.from, range.to)
          .filter((n) => n.indexed)
          .map(toIndexedPage),
        pageText: pageText(doc.id),
        language: language(doc),
        ...(signal === undefined ? {} : { signal })
      }
    }
  }
}
