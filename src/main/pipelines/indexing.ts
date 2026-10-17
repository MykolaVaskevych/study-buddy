import type { DocId, IndexStatus, JobInfo, PageNotes } from '@shared/domain'
import type { ChunkRow } from '../db/types'
import type { JobContext } from '../jobs/types'
import type { ChunkInfo } from '../library/types'
import { fatal, notFound } from './errors'
import type { JobWaiter } from './job-waiter'
import type { Material } from './material'
import { indexChunkPayload, parsePayload, type IndexChunkPayload } from './payloads'
import { ACTIVE_JOB_STATES, JOB_SCAN_LIMIT, PRIORITY, TERMINAL_JOB_STATES } from './priorities'
import { requireDoc, requirePage } from './scope'
import type { Handlers, PipelineDeps } from './types'
import { ServiceError } from './types'
import type { UsageLedger } from './usage'

/**
 * The AI index pass: one `index_chunk` job per chunk with unindexed pages. The chunk the reader is
 * on jumps the queue. When the last job of a round settles, the document becomes 'done' (and the
 * topic map is built), 'error' (some chunk failed) or 'paused' (jobs were cancelled).
 */
export interface Indexing {
  handlers: Pick<Handlers, 'index.start' | 'index.pause' | 'index.status' | 'index.focus'>
  /** Enqueues every chunk with unindexed pages. `auto` (after import) leaves a paused document alone. */
  start(docId: DocId, opts?: { auto: boolean }): Promise<IndexStatus>
  /** Indexes the page's chunk now (top priority) if needed, waits, and returns the page notes. */
  ensurePage(docId: DocId, page: number): Promise<PageNotes>
  runJob(payload: unknown, ctx: JobContext): Promise<void>
  /** Queue listener: detects the end of an indexing round. */
  onJobChange(job: JobInfo): void
  /** After a restart: documents left 'queued'/'running' with no jobs finish their round. */
  reconcile(): void
}

interface Round {
  failed: string | null
  cancelled: boolean
}

export const indexDedupeKey = (docId: DocId, chunkIndex: number): string => `index:${docId}:${chunkIndex}`

const contains = (c: ChunkInfo, page: number): boolean => c.startPage <= page && page <= c.endPage

export function createIndexing(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'emit' | 'library'>,
  services: {
    ledger: UsageLedger
    material: Material
    waiter: JobWaiter
    /** Called when a round completed cleanly: build the topic map. */
    onIndexed(docId: DocId): void
  }
): Indexing {
  const { db, queue } = deps
  const { ledger, material, waiter } = services
  const rounds = new Map<DocId, Round>()

  const status = (docId: DocId): IndexStatus => requireDoc(db, docId).index

  const emitProgress = (docId: DocId): void => {
    const doc = db.documents.get(docId)
    if (doc) deps.emit('index.progress', { docId, status: doc.index })
  }

  const activeIndexJobs = (docId: DocId): JobInfo[] =>
    db.jobs
      .list(docId, JOB_SCAN_LIMIT)
      .filter((j) => j.kind === 'index_chunk' && ACTIVE_JOB_STATES.has(j.state))

  const fullyIndexed = (c: ChunkRow, indexed: ReadonlySet<number>): boolean => {
    for (let p = c.startPage; p <= c.endPage; p++) if (!indexed.has(p)) return false
    return true
  }

  const enqueueChunk = (docId: DocId, c: ChunkInfo, priority: number): JobInfo =>
    queue.enqueue<IndexChunkPayload>({
      kind: 'index_chunk',
      docId,
      payload: { docId, chunkIndex: c.index, startPage: c.startPage, endPage: c.endPage },
      priority,
      dedupeKey: indexDedupeKey(docId, c.index),
      label: `Indexing pages ${c.startPage}–${c.endPage}`
    })

  /** Ends the round if no index job of the document is left. */
  const settleRound = (docId: DocId): void => {
    if (activeIndexJobs(docId).length > 0) return
    const doc = db.documents.get(docId)
    // Paused, done or never started: a single on-demand chunk finishing does not change the state.
    if (!doc || (doc.index.state !== 'queued' && doc.index.state !== 'running')) return
    const round = rounds.get(docId) ?? { failed: null, cancelled: false }
    rounds.delete(docId)
    if (round.failed !== null) db.documents.setIndexState(docId, 'error', round.failed)
    else if (round.cancelled) db.documents.setIndexState(docId, 'paused')
    else {
      db.documents.setIndexState(docId, 'done')
      services.onIndexed(docId)
    }
    emitProgress(docId)
  }

  async function start(docId: DocId, opts: { auto: boolean } = { auto: false }): Promise<IndexStatus> {
    const doc = requireDoc(db, docId)
    if (opts.auto && doc.index.state === 'paused') return doc.index
    const grid = await material.grid(doc)
    const indexed = new Set(db.pages.indexedPages(docId))
    const pending = grid.filter((c) => !fullyIndexed(c, indexed))
    rounds.set(docId, { failed: null, cancelled: false })
    if (pending.length === 0) {
      db.documents.setIndexState(docId, 'done')
      if (indexed.size > 0 && db.topics.list(docId).length === 0) services.onIndexed(docId)
    } else {
      const running = activeIndexJobs(docId).some((j) => j.state === 'running')
      db.documents.setIndexState(docId, running ? 'running' : 'queued')
      for (const c of pending) enqueueChunk(docId, c, PRIORITY.bulkIndex)
    }
    emitProgress(docId)
    return status(docId)
  }

  async function runJob(raw: unknown, ctx: JobContext): Promise<void> {
    const p = parsePayload(indexChunkPayload, raw)
    const doc = db.documents.get(p.docId)
    if (!doc) return
    if (doc.index.state === 'queued') {
      db.documents.setIndexState(doc.id, 'running')
      emitProgress(doc.id)
    }
    const chunk = p.retry
      ? await deps.library.buildFocusChunk(doc.sha256, doc.pageCount, p.startPage, p.endPage)
      : await (async () => {
          const grid = await material.grid(doc, { from: p.startPage, to: p.endPage })
          return (
            grid.find((c) => c.startPage === p.startPage && c.endPage === p.endPage) ??
            grid.find((c) => c.index === p.chunkIndex)
          )
        })()
    if (!chunk) throw fatal(`Pages ${p.startPage}–${p.endPage} are no longer a chunk of this document`)
    const pageText = material.pageText(doc.id)
    const result = await ledger.run(doc.id, (ai) => ai.indexChunk({ chunk, pageText, signal: ctx.signal }))
    // The document may have been deleted while the model was working.
    if (!db.documents.get(doc.id)) return
    db.transaction(() => {
      for (const page of result.pages) {
        db.pages.saveIndex(doc.id, page.page, {
          page: page.page,
          kind: page.kind,
          teachable: page.teachable,
          summary: page.summary,
          keyPoints: page.keyPoints,
          concepts: page.concepts,
          formulas: page.formulas,
          exercises: page.exercises,
          examSignals: page.examSignals
        })
      }
      if (doc.language === null && result.language.trim() !== '')
        db.documents.setLanguage(doc.id, result.language)
    })
    if (result.missingPages.length > 0 && !p.retry) {
      // One cheap retry with a focus chunk of just the skipped pages, instead of the whole chunk again.
      const from = Math.min(...result.missingPages)
      const to = Math.max(...result.missingPages)
      queue.enqueue<IndexChunkPayload>({
        kind: 'index_chunk',
        docId: doc.id,
        payload: { docId: doc.id, chunkIndex: -1, startPage: from, endPage: to, retry: true },
        priority: PRIORITY.bulkIndex,
        dedupeKey: `index:${doc.id}:retry:${from}-${to}`,
        label: `Indexing skipped pages ${from}–${to}`
      })
    } else if (result.missingPages.length > 0) {
      console.warn(
        `[pipelines] index retry still skipped pages ${result.missingPages.join(', ')} of ${doc.id}`
      )
    }
    emitProgress(doc.id)
  }

  return {
    start,
    runJob,

    async ensurePage(docId, page) {
      const notes = db.pages.notes(docId, page)
      if (notes?.indexed) return notes
      const doc = requireDoc(db, docId)
      requirePage(doc, page)
      const chunk = (await material.grid(doc)).find((c) => contains(c, page))
      if (!chunk) throw new ServiceError('validation', `No chunk covers page ${page}`)
      await waiter.done(enqueueChunk(docId, chunk, PRIORITY.focus).id)
      const after = db.pages.notes(docId, page)
      if (!after) throw notFound('Page', `${docId}#${page}`)
      return after
    },

    onJobChange(job) {
      if (job.kind !== 'index_chunk' || job.docId === null || !TERMINAL_JOB_STATES.has(job.state)) return
      const round = rounds.get(job.docId) ?? { failed: null, cancelled: false }
      if (job.state === 'failed') round.failed = job.error ?? `${job.label} failed`
      if (job.state === 'cancelled') round.cancelled = true
      rounds.set(job.docId, round)
      settleRound(job.docId)
    },

    reconcile() {
      for (const doc of db.documents.list()) {
        if (doc.index.state === 'queued' || doc.index.state === 'running') settleRound(doc.id)
      }
    },

    handlers: {
      'index.start': ({ docId }) => start(docId),

      'index.status': async ({ docId }) => status(docId),

      'index.pause': async ({ docId }) => {
        const doc = requireDoc(db, docId)
        // Set first: the cancellations below settle the round, and a paused round stays paused.
        if (doc.index.state === 'queued' || doc.index.state === 'running') {
          db.documents.setIndexState(docId, 'paused')
        }
        // Running chunks finish: their call is already paid for.
        for (const job of activeIndexJobs(docId)) if (job.state !== 'running') queue.cancel(job.id)
        emitProgress(docId)
        return status(docId)
      },

      'index.focus': async ({ docId, page }) => {
        const doc = requireDoc(db, docId)
        requirePage(doc, page)
        const rows = db.pages.chunks(docId)
        const at = rows.findIndex((c) => contains(c, page))
        if (at < 0) return { ok: true }
        const indexed = new Set(db.pages.indexedPages(docId))
        // A paused, finished or failed index stays as the user left it: only queued work moves up.
        const mayEnqueue = doc.index.state === 'queued' || doc.index.state === 'running'
        for (const c of [rows[at], rows[at + 1]]) {
          if (!c) continue
          const active = db.jobs.findActive(indexDedupeKey(docId, c.index))
          if (active) queue.bump(active.id, PRIORITY.focus)
          else if (mayEnqueue && !fullyIndexed(c, indexed)) enqueueChunk(docId, c, PRIORITY.focus)
        }
        return { ok: true }
      }
    }
  }
}
