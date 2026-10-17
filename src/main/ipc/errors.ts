import type { z } from 'zod'
import { AiError } from '@shared/ai/provider'
import type { IpcEnvelope } from '@shared/ipc/contract'
import { LibraryError, type LibraryErrorKind } from '../library/types'
import { ServiceError } from '../pipelines/types'
import type { Log } from '../app/log'

/**
 * Maps whatever a handler throws to an envelope error. Expected failures (ServiceError, AiError,
 * LibraryError) keep a message the UI can show; anything else is a bug: its stack goes to the log
 * and the renderer only gets a generic message, so internals never leak into the UI.
 */

export type IpcFailure = Extract<IpcEnvelope<never>, { ok: false }>

export const INTERNAL_ERROR_MESSAGE =
  'Something went wrong inside Study Buddy. The details were written to the log.'

const LIBRARY_MESSAGES: Record<LibraryErrorKind, string> = {
  not_pdf: 'This file is not a PDF.',
  encrypted: 'Password-protected or copy-restricted PDFs are not supported yet.',
  corrupt: 'This PDF looks damaged and could not be read.',
  too_large: 'This PDF is too large to import.',
  io: 'The file could not be read or saved. Check that it still exists and that the disk has free space.'
}

/** One line per zod issue, `path: message`, joined with '; '. */
export function formatValidationIssues(issues: readonly z.core.$ZodIssue[]): string {
  return issues
    .map((issue) => (issue.path.length > 0 ? `${issue.path.map(String).join('.')}: ` : '') + issue.message)
    .join('; ')
}

export function toIpcFailure(err: unknown, ctx: { channel: string; log: Log }): IpcFailure {
  const { channel, log } = ctx
  if (err instanceof ServiceError)
    return { ok: false, error: { kind: err.kind, message: err.message, resetAt: err.resetAt } }

  if (err instanceof AiError) {
    if (err.kind === 'rate_limited')
      return { ok: false, error: { kind: 'rate_limited', message: err.message, resetAt: err.resetAt } }
    log.warn(`${channel}: AI error (${err.kind}): ${err.message}`)
    return { ok: false, error: { kind: 'ai', message: err.message } }
  }

  if (err instanceof LibraryError) {
    log.warn(`${channel}: library error (${err.kind}): ${err.message}`)
    return { ok: false, error: { kind: 'validation', message: LIBRARY_MESSAGES[err.kind] } }
  }

  // Repositories throw NotFoundError for stale ids (e.g. a document deleted meanwhile). Matched by name
  // so the IPC layer does not depend on the db module.
  if (err instanceof Error && err.name === 'NotFoundError')
    return { ok: false, error: { kind: 'not_found', message: err.message } }

  log.error(`${channel} failed`, err)
  return { ok: false, error: { kind: 'internal', message: INTERNAL_ERROR_MESSAGE } }
}
