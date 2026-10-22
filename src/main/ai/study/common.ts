import { AiError, type AiTask, type GenerateResult } from '@shared/ai/provider'
import { ROUTING_PRESETS, type Route, type RoutedTask } from '@shared/ai/routing'
import type { ChunkInfo } from '../../library/types'
import { DEFAULT_GROUNDING_THRESHOLD } from '../quality/grounding'
import { DEFAULT_DEDUPE_THRESHOLD } from '../quality/dedupe'
import type { UsageRecord } from '../types'

/** Tunables of createStudyAi; every field has a default. */
export interface StudyAiOptions {
  /** Share of quote words that must be found on the page (default 0.8). */
  groundingThreshold?: number
  /** Trigram similarity at which two fronts/stems count as duplicates (default 0.8). */
  dedupeThreshold?: number
  /** Raw PDF bytes per request. Base64 adds a third, and the API caps requests at 32 MB. Default 22 MB. */
  maxRequestBytes?: number
  /** PDF pages per request (default 100). */
  maxRequestPages?: number
  /** Model and effort per task (default: the "best quality" preset, every generator on the strong model). */
  routes?: Record<RoutedTask, Route>
  /** Redo weak batches of fast-model flashcards and page checks once on the strong model (default true). */
  escalate?: boolean
}

export type ResolvedOptions = Required<StudyAiOptions>

export function resolveOptions(opts: StudyAiOptions): ResolvedOptions {
  return {
    groundingThreshold: opts.groundingThreshold ?? DEFAULT_GROUNDING_THRESHOLD,
    dedupeThreshold: opts.dedupeThreshold ?? DEFAULT_DEDUPE_THRESHOLD,
    maxRequestBytes: opts.maxRequestBytes ?? 22 * 1024 * 1024,
    maxRequestPages: opts.maxRequestPages ?? 100,
    routes: opts.routes ?? ROUTING_PRESETS.quality,
    escalate: opts.escalate ?? true
  }
}

export function usageRecord<T>(task: AiTask, result: GenerateResult<T>): UsageRecord {
  return { task, model: result.model, usage: result.usage }
}

/**
 * The chunks to send for pages from..to: every chunk overlapping the range, in page order.
 * Fails (non-retryable) when the range is invalid, not fully covered, or too large for one
 * request; the caller must then split the scope (e.g. per topic) rather than have pages
 * silently dropped.
 */
export function selectChunks(
  chunks: readonly ChunkInfo[],
  from: number,
  to: number,
  opts: Pick<ResolvedOptions, 'maxRequestBytes' | 'maxRequestPages'>
): ChunkInfo[] {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || from > to)
    throw new AiError('unknown', `Invalid page range ${from}-${to}`, { retryable: false })
  const selected = chunks
    .filter((c) => c.endPage >= from && c.startPage <= to)
    .sort((a, b) => a.startPage - b.startPage)
  let next = from
  for (const c of selected) {
    if (c.startPage > next) break
    next = Math.max(next, c.endPage + 1)
  }
  if (next <= to)
    throw new AiError('unknown', `No chunk PDF covers page ${next} of the range ${from}-${to}`, {
      retryable: false
    })
  const bytes = selected.reduce((acc, c) => acc + c.bytes, 0)
  const pages = selected.reduce((acc, c) => acc + c.endPage - c.startPage + 1, 0)
  if (bytes > opts.maxRequestBytes || pages > opts.maxRequestPages)
    throw new AiError(
      'unknown',
      `Pages ${from}-${to} need ${selected.length} chunk PDFs (${pages} pages, ${(bytes / 1048576).toFixed(1)} MB), more than one request allows; split the range`,
      { retryable: false }
    )
  return selected
}
