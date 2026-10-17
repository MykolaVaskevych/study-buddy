import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { CustomScheme, Privileges } from 'electron'
import { PDF_SCHEME } from '@shared/ipc/contract'
import type { Log } from './log'

/**
 * Serves stored PDFs to the renderer at `sb-pdf://doc/<docId>`.
 * The doc id is only ever a database lookup key: the file path comes from `resolvePath` (the DB),
 * never from the URL, so path traversal is impossible by construction.
 * The request -> response logic is a pure function (`servePdfRequest`) tested without Electron.
 */

/**
 * `corsEnabled` lets the renderer (file:// or the dev server, both other origins) fetch the bytes;
 * `supportFetchAPI` + `stream` make fetch() work and allow streamed bodies; `standard` + `secure`
 * give the scheme normal URL parsing and a secure context.
 */
export const PDF_SCHEME_PRIVILEGES: Privileges = {
  standard: true,
  secure: true,
  supportFetchAPI: true,
  stream: true,
  corsEnabled: true
}

/** Must run before the app's `ready` event (Electron requirement). */
export function registerPdfScheme(protocol: {
  registerSchemesAsPrivileged(schemes: CustomScheme[]): void
}): void {
  protocol.registerSchemesAsPrivileged([{ scheme: PDF_SCHEME, privileges: PDF_SCHEME_PRIVILEGES }])
}

/** Inclusive byte range. */
export interface ByteRange {
  start: number
  end: number
}

/** File access used by the handler (injected so tests can count reads or simulate failures). */
export interface PdfFiles {
  /** Size in bytes, or null when the file does not exist. */
  size(path: string): Promise<number | null>
  stream(path: string, range: ByteRange): ReadableStream<Uint8Array>
}

export interface PdfRequest {
  method: string
  url: string
  headers: { get(name: string): string | null }
}

export interface ServePdfDeps {
  /** Stored PDF path for a document id, or null if there is no such document. */
  resolvePath(docId: string): string | null
  files: PdfFiles
  log?: Log
}

const CORS_HEADERS: Record<string, string> = {
  // No credentials are involved and only our renderer is ever loaded, so a wildcard is enough; it also
  // covers file:// pages, whose origin is the opaque 'null'.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Length, Content-Range'
}

/** `sb-pdf://doc/<docId>` -> docId, else null. */
export function parsePdfUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== `${PDF_SCHEME}:` || parsed.hostname !== 'doc') return null
  const segments = parsed.pathname.split('/').filter((s) => s !== '')
  if (segments.length !== 1 || segments[0] === undefined) return null
  try {
    const docId = decodeURIComponent(segments[0])
    return docId.length > 0 ? docId : null
  } catch {
    return null
  }
}

/**
 * Parses a `Range` header against a file size (RFC 9110). Returns null when the header is absent,
 * malformed or asks for several ranges (we then serve the whole file, which the RFC allows), and
 * 'unsatisfiable' when it starts beyond the end of the file.
 */
export function parseRange(header: string | null, size: number): ByteRange | 'unsatisfiable' | null {
  if (header === null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!m) return null
  const [, from = '', to = ''] = m
  if (from === '' && to === '') return null
  if (from === '') {
    // Suffix range: the last N bytes.
    const length = Number(to)
    if (length === 0) return 'unsatisfiable'
    return size === 0 ? 'unsatisfiable' : { start: Math.max(0, size - length), end: size - 1 }
  }
  const start = Number(from)
  const end = to === '' ? size - 1 : Math.min(Number(to), size - 1)
  if (to !== '' && Number(to) < start) return null
  if (start >= size) return 'unsatisfiable'
  return { start, end }
}

function text(status: number, body: string, extra: Record<string, string> = {}): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'Content-Type': 'text/plain; charset=utf-8', ...extra }
  })
}

/** Turns one protocol request into a response: 200 / 206 / 404 / 405 / 416 / 500. */
export async function servePdfRequest(req: PdfRequest, deps: ServePdfDeps): Promise<Response> {
  const method = req.method.toUpperCase()
  if (method === 'OPTIONS')
    return new Response(null, {
      status: 204,
      headers: {
        ...CORS_HEADERS,
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': 'Range'
      }
    })
  if (method !== 'GET' && method !== 'HEAD')
    return text(405, 'Method not allowed', { Allow: 'GET, HEAD, OPTIONS' })

  const docId = parsePdfUrl(req.url)
  if (docId === null) return text(404, 'Not found')

  try {
    const path = deps.resolvePath(docId)
    if (path === null) return text(404, 'Not found')
    const size = await deps.files.size(path)
    if (size === null) return text(404, 'Not found')

    const base: Record<string, string> = {
      ...CORS_HEADERS,
      'Content-Type': 'application/pdf',
      'Accept-Ranges': 'bytes',
      'X-Content-Type-Options': 'nosniff'
    }
    const range = parseRange(req.headers.get('range'), size)
    if (range === 'unsatisfiable')
      return new Response(null, { status: 416, headers: { ...base, 'Content-Range': `bytes */${size}` } })

    const span = range ?? { start: 0, end: size - 1 }
    const length = size === 0 ? 0 : span.end - span.start + 1
    const headers: Record<string, string> = { ...base, 'Content-Length': String(length) }
    if (range) headers['Content-Range'] = `bytes ${range.start}-${range.end}/${size}`
    const body = method === 'HEAD' || length === 0 ? null : deps.files.stream(path, span)
    return new Response(body, { status: range ? 206 : 200, headers })
  } catch (err) {
    deps.log?.error(`sb-pdf: cannot serve document ${docId}`, err)
    return text(500, 'Could not read the PDF')
  }
}

/** Node fs implementation of PdfFiles. */
export const nodePdfFiles: PdfFiles = {
  async size(path) {
    try {
      const info = await stat(path)
      return info.isFile() ? info.size : null
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code
      if (code === 'ENOENT' || code === 'ENOTDIR') return null
      throw err
    }
  },
  stream(path, range) {
    return Readable.toWeb(createReadStream(path, { start: range.start, end: range.end }))
  }
}

/** The part of Electron's `protocol` used here (injected so tests run without Electron). */
export interface PdfProtocolHost {
  handle(scheme: string, handler: (request: Request) => Response | Promise<Response>): void
  unhandle(scheme: string): void
}

/**
 * Installs the sb-pdf handler. Call after the app is ready, once the database can resolve paths.
 * Returns a function that removes the handler.
 */
export function registerPdfProtocol(
  protocol: PdfProtocolHost,
  resolvePath: (docId: string) => string | null,
  opts: { files?: PdfFiles; log?: Log } = {}
): () => void {
  const deps: ServePdfDeps = { resolvePath, files: opts.files ?? nodePdfFiles, log: opts.log }
  protocol.handle(PDF_SCHEME, (request) => servePdfRequest(request, deps))
  return () => protocol.unhandle(PDF_SCHEME)
}
