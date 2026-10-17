import { LibraryError, type LibraryErrorKind } from './types'

/**
 * Error helpers. Callers of the library only ever see `LibraryError`, so every failure is mapped to a
 * kind at the place where its meaning is known (file IO, PDF parsing, encryption) and then passed
 * through unchanged. Errors cross the worker boundary as plain `{ kind, message }` objects.
 */

const KINDS: readonly LibraryErrorKind[] = ['not_pdf', 'encrypted', 'corrupt', 'too_large', 'io']

export function isLibraryErrorKind(value: unknown): value is LibraryErrorKind {
  return typeof value === 'string' && (KINDS as readonly string[]).includes(value)
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Keeps an existing LibraryError, otherwise wraps the failure with the given kind. */
export function asLibraryError(err: unknown, kind: LibraryErrorKind, context: string): LibraryError {
  if (err instanceof LibraryError) return err
  return new LibraryError(kind, `${context}: ${errorMessage(err)}`, err)
}

/** Node fs errors carry a string `code` such as ENOENT, EACCES or ENOSPC. */
export function isNodeIoError(err: unknown): err is NodeJS.ErrnoException {
  return err instanceof Error && typeof (err as NodeJS.ErrnoException).code === 'string'
}

/** Runs a filesystem step and reports any failure as `io`. */
export async function io<T>(context: string, step: () => Promise<T>): Promise<T> {
  try {
    return await step()
  } catch (err) {
    throw asLibraryError(err, 'io', context)
  }
}

export interface SerializedLibraryError {
  kind: LibraryErrorKind
  message: string
}

/** Converts any failure into a structured-clone-safe shape. Unknown errors count as `corrupt` input. */
export function serializeLibraryError(err: unknown): SerializedLibraryError {
  if (err instanceof LibraryError) return { kind: err.kind, message: err.message }
  return { kind: isNodeIoError(err) ? 'io' : 'corrupt', message: errorMessage(err) }
}

export function deserializeLibraryError(value: unknown): LibraryError {
  if (typeof value === 'object' && value !== null && 'kind' in value && 'message' in value) {
    const { kind, message } = value
    if (isLibraryErrorKind(kind) && typeof message === 'string') return new LibraryError(kind, message)
  }
  return new LibraryError('io', `PDF worker sent a malformed error: ${JSON.stringify(value)}`)
}
