import type { DocId, Scope, Topic, TopicId } from '@shared/domain'
import type { Database } from '../db/types'
import type { ChunkInfo } from '../library/types'
import { fatal, messageOf, notFound } from './errors'
import { ServiceError } from './types'

/**
 * Scopes and page windows. A scope (page, range, topic, document) resolves to an absolute page range;
 * large ranges are split into windows that each fit one AI request.
 */

/** Absolute, inclusive, 1-based page range. */
export interface PageRange {
  from: number
  to: number
}

export type DocRecord = NonNullable<ReturnType<Database['documents']['get']>>

export interface ResolvedScope extends PageRange {
  doc: DocRecord
  /** The topic for topic scopes, else null. */
  topic: Topic | null
}

export const pagesIn = (r: PageRange): number => r.to - r.from + 1

/** Loads the document or throws not_found. */
export function requireDoc(db: Database, docId: DocId): DocRecord {
  const doc = db.documents.get(docId)
  if (!doc) throw notFound('Document', docId)
  return doc
}

export function requirePage(doc: DocRecord, page: number): void {
  if (page < 1 || page > doc.pageCount) {
    throw new ServiceError('validation', `Page ${page} is outside this document (1-${doc.pageCount})`)
  }
}

/** Page range of a scope, validated against the document. */
export function resolveScope(db: Database, scope: Scope): ResolvedScope {
  const doc = requireDoc(db, scope.docId)
  switch (scope.kind) {
    case 'page':
      requirePage(doc, scope.page)
      return { doc, topic: null, from: scope.page, to: scope.page }
    case 'range': {
      const from = Math.min(scope.from, scope.to)
      const to = Math.max(scope.from, scope.to)
      requirePage(doc, from)
      requirePage(doc, to)
      return { doc, topic: null, from, to }
    }
    case 'topic': {
      const topic = db.topics.get(scope.topicId)
      if (!topic || topic.docId !== doc.id) throw notFound('Topic', scope.topicId)
      return {
        doc,
        topic,
        from: Math.max(1, topic.pageStart),
        to: Math.min(doc.pageCount, topic.pageEnd)
      }
    }
    case 'document':
      return { doc, topic: null, from: 1, to: doc.pageCount }
  }
}

/** resolveScope for job handlers: a scope that no longer resolves (topic map rebuilt) cannot succeed later. */
export function resolveJobScope(db: Database, scope: Scope): ResolvedScope {
  try {
    return resolveScope(db, scope)
  } catch (err) {
    throw fatal(messageOf(err))
  }
}

/** Stable identity of a scope, used in job dedupe keys. */
export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case 'page':
      return `${scope.docId}:p${scope.page}`
    case 'range':
      return `${scope.docId}:r${Math.min(scope.from, scope.to)}-${Math.max(scope.from, scope.to)}`
    case 'topic':
      return `${scope.docId}:t${scope.topicId}`
    case 'document':
      return `${scope.docId}:all`
  }
}

/** Human label for job lists, e.g. "p. 4", "pages 3–9", "Fibre attenuation", "the whole document". */
export function scopeLabel(resolved: ResolvedScope): string {
  if (resolved.topic) return resolved.topic.title
  if (resolved.from === 1 && resolved.to === resolved.doc.pageCount && resolved.to > 1)
    return 'the whole document'
  return resolved.from === resolved.to ? `p. ${resolved.from}` : `pages ${resolved.from}–${resolved.to}`
}

/** Topics without children: the units the planner, mock exams and document splits work with. */
export function leafTopics(topics: readonly Topic[]): Topic[] {
  const parents = new Set(topics.flatMap((t) => (t.parentId === null ? [] : [t.parentId])))
  return topics.filter((t) => !parents.has(t.id))
}

/** Leaf topics below (or equal to) `rootId`. */
export function leavesUnder(topics: readonly Topic[], rootId: TopicId): Topic[] {
  const below = new Set<TopicId>([rootId])
  // Parents may be listed after children, so propagate until nothing changes (cycle-safe: a set).
  for (let grew = true; grew;) {
    grew = false
    for (const t of topics) {
      if (t.parentId !== null && below.has(t.parentId) && !below.has(t.id)) {
        below.add(t.id)
        grew = true
      }
    }
  }
  return leafTopics(topics).filter((t) => below.has(t.id))
}

/** Grid chunks overlapping the range, in page order. */
export function coveringChunks(grid: readonly ChunkInfo[], range: PageRange): ChunkInfo[] {
  return grid
    .filter((c) => c.endPage >= range.from && c.startPage <= range.to)
    .sort((a, b) => a.startPage - b.startPage)
}

export interface WindowLimits {
  /** Most pages one generation request should focus on. */
  windowPages: number
  /** Most raw PDF bytes one request may carry (estimated from the covering grid chunks). */
  maxBytes: number
}

const coveringBytes = (grid: readonly ChunkInfo[], r: PageRange): number =>
  coveringChunks(grid, r).reduce((sum, c) => sum + c.bytes, 0)

function fits(r: PageRange, grid: readonly ChunkInfo[], limits: WindowLimits): boolean {
  return pagesIn(r) <= limits.windowPages && coveringBytes(grid, r) <= limits.maxBytes
}

/** Equal windows of at most windowPages, then halves until each fits the byte limit (or is one page). */
function splitToFit(r: PageRange, grid: readonly ChunkInfo[], limits: WindowLimits): PageRange[] {
  if (fits(r, grid, limits) || r.from === r.to) return [r]
  const parts = Math.max(2, Math.ceil(pagesIn(r) / limits.windowPages))
  const size = Math.ceil(pagesIn(r) / parts)
  const out: PageRange[] = []
  for (let from = r.from; from <= r.to; from += size) {
    out.push(...splitToFit({ from, to: Math.min(r.to, from + size - 1) }, grid, limits))
  }
  return out
}

/** Leaf topics clipped to the range, gaps between them filled, in page order: a tiling of the range. */
export function topicPieces(
  range: PageRange,
  leaves: readonly { pageStart: number; pageEnd: number }[]
): PageRange[] {
  const clipped = leaves
    .map((t) => ({ from: Math.max(range.from, t.pageStart), to: Math.min(range.to, t.pageEnd) }))
    .filter((r) => r.from <= r.to)
    .sort((a, b) => a.from - b.from || a.to - b.to)
  const out: PageRange[] = []
  let next = range.from
  for (const r of clipped) {
    if (r.to < next) continue // overlapping siblings: the earlier one already covers these pages
    const from = Math.max(r.from, next)
    if (from > next) out.push({ from: next, to: from - 1 })
    out.push({ from, to: r.to })
    next = r.to + 1
  }
  if (next <= range.to) out.push({ from: next, to: range.to })
  return out
}

/**
 * Splits a range into windows that each fit one request. The AI refuses requests over ~100 pages or
 * 22 MB, so large scopes must be split here rather than fail. Boundaries follow leaf topics, so
 * a window is about one subject; adjacent small pieces are merged back (fewer calls, and each call
 * re-sends the system prompt and its PDFs). With `byTopic`, pieces are never merged: the document
 * scope wants one generation per topic, each with its own item count.
 */
export function planWindows(
  range: PageRange,
  opts: {
    leaves: readonly { pageStart: number; pageEnd: number }[]
    grid: readonly ChunkInfo[]
    byTopic: boolean
  } & WindowLimits
): PageRange[] {
  if (!opts.byTopic && fits(range, opts.grid, opts)) return [range]
  const pieces = topicPieces(range, opts.leaves).flatMap((p) => splitToFit(p, opts.grid, opts))
  if (opts.byTopic) return pieces
  const merged: PageRange[] = []
  for (const piece of pieces) {
    const last = merged[merged.length - 1]
    const joined = last ? { from: last.from, to: piece.to } : null
    if (last && joined && fits(joined, opts.grid, opts)) merged[merged.length - 1] = joined
    else merged.push(piece)
  }
  return merged
}

/**
 * The extra PDF to send for a small range: the range plus one neighbour page on each side (context
 * for slides that continue), when that is fewer pages than the grid chunks covering the range.
 * Returns null when the grid chunks should be sent as they are (large ranges, aligned chunks).
 */
export function focusChunkRange(
  range: PageRange,
  pageCount: number,
  grid: readonly ChunkInfo[],
  focusMaxPages: number
): PageRange | null {
  if (pagesIn(range) > focusMaxPages) return null
  const focus = { from: Math.max(1, range.from - 1), to: Math.min(pageCount, range.to + 1) }
  const gridPages = coveringChunks(grid, range).reduce((sum, c) => sum + c.endPage - c.startPage + 1, 0)
  return pagesIn(focus) < gridPages ? focus : null
}
