import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PDF_SCHEME, pdfUrl } from '@shared/ipc/contract'
import { memoryLog } from '../ipc/test-helpers'
import {
  nodePdfFiles,
  parsePdfUrl,
  parseRange,
  registerPdfProtocol,
  registerPdfScheme,
  servePdfRequest,
  type PdfProtocolHost,
  type ServePdfDeps
} from './pdf-protocol'

describe('parsePdfUrl', () => {
  it('extracts the doc id from pdfUrl()', () => {
    expect(parsePdfUrl(pdfUrl('doc-1'))).toBe('doc-1')
    expect(parsePdfUrl(pdfUrl('a b/c'))).toBe('a b/c')
    expect(parsePdfUrl('sb-pdf://doc/doc-1/')).toBe('doc-1')
    expect(parsePdfUrl('sb-pdf://doc/doc-1?x=1#page=2')).toBe('doc-1')
  })

  it.each([
    'sb-pdf://other/doc-1',
    'sb-pdf://doc/',
    'sb-pdf://doc/a/b',
    'https://doc/doc-1',
    'sb-pdf://doc/%E0%A4%A',
    'not a url'
  ])('rejects %s', (url) => {
    expect(parsePdfUrl(url)).toBeNull()
  })
})

describe('parseRange', () => {
  const size = 1000
  it.each<[string | null, ReturnType<typeof parseRange>]>([
    [null, null],
    ['bytes=0-99', { start: 0, end: 99 }],
    ['bytes=100-', { start: 100, end: 999 }],
    ['bytes=-50', { start: 950, end: 999 }],
    ['bytes=-5000', { start: 0, end: 999 }],
    ['bytes=900-5000', { start: 900, end: 999 }],
    ['bytes=999-999', { start: 999, end: 999 }],
    ['bytes=1000-', 'unsatisfiable'],
    ['bytes=-0', 'unsatisfiable'],
    ['bytes=5-3', null],
    ['bytes=0-1,5-9', null],
    ['items=0-1', null],
    ['bytes=-', null],
    ['bytes=abc', null]
  ])('%s', (header, expected) => {
    expect(parseRange(header, size)).toEqual(expected)
  })
})

describe('servePdfRequest', () => {
  const bytes = Uint8Array.from({ length: 1000 }, (_, i) => i % 256)
  let dir: string
  let path: string
  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'sb-pdf-'))
    path = join(dir, 'stored.pdf')
    await writeFile(path, bytes)
  })
  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  const deps = (over: Partial<ServePdfDeps> = {}): ServePdfDeps => ({
    resolvePath: (docId) => (docId === 'doc-1' ? path : null),
    files: nodePdfFiles,
    ...over
  })
  const request = (url: string, init: { method?: string; range?: string } = {}) => ({
    method: init.method ?? 'GET',
    url,
    headers: new Headers(init.range ? { Range: init.range } : {})
  })
  const body = async (res: Response) => new Uint8Array(await res.arrayBuffer())

  it('serves the whole file with PDF, range and CORS headers', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1')), deps())
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/pdf')
    expect(res.headers.get('content-length')).toBe('1000')
    expect(res.headers.get('accept-ranges')).toBe('bytes')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(await body(res)).toEqual(bytes)
  })

  it('answers a Range request with 206 and the slice', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1'), { range: 'bytes=10-19' }), deps())
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 10-19/1000')
    expect(res.headers.get('content-length')).toBe('10')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('access-control-expose-headers')).toContain('Content-Range')
    expect(await body(res)).toEqual(bytes.slice(10, 20))
  })

  it('serves an open-ended range to the end of the file', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1'), { range: 'bytes=990-' }), deps())
    expect(res.status).toBe(206)
    expect(res.headers.get('content-range')).toBe('bytes 990-999/1000')
    expect(await body(res)).toEqual(bytes.slice(990))
  })

  it('answers an unsatisfiable range with 416', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1'), { range: 'bytes=5000-' }), deps())
    expect(res.status).toBe(416)
    expect(res.headers.get('content-range')).toBe('bytes */1000')
  })

  it('returns 404 with CORS headers for an unknown document', async () => {
    const res = await servePdfRequest(request(pdfUrl('nope')), deps())
    expect(res.status).toBe(404)
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('returns 404 when the stored file is missing on disk', async () => {
    const res = await servePdfRequest(
      request(pdfUrl('doc-1')),
      deps({ resolvePath: () => join(dir, 'gone.pdf') })
    )
    expect(res.status).toBe(404)
  })

  it('only uses the doc id as a lookup key, so traversal ids never reach the file system', async () => {
    const resolvePath = vi.fn(() => null)
    const size = vi.fn(nodePdfFiles.size)
    const res = await servePdfRequest(
      request('sb-pdf://doc/..%2F..%2Fetc%2Fpasswd'),
      deps({ resolvePath, files: { ...nodePdfFiles, size } })
    )
    expect(res.status).toBe(404)
    expect(resolvePath).toHaveBeenCalledWith('../../etc/passwd')
    expect(size).not.toHaveBeenCalled()
  })

  it('answers HEAD without a body', async () => {
    const stream = vi.fn(nodePdfFiles.stream)
    const res = await servePdfRequest(
      request(pdfUrl('doc-1'), { method: 'HEAD' }),
      deps({ files: { ...nodePdfFiles, stream } })
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe('1000')
    expect(stream).not.toHaveBeenCalled()
  })

  it('answers a CORS preflight', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1'), { method: 'OPTIONS' }), deps())
    expect(res.status).toBe(204)
    expect(res.headers.get('access-control-allow-headers')).toBe('Range')
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
  })

  it('rejects other methods with 405', async () => {
    const res = await servePdfRequest(request(pdfUrl('doc-1'), { method: 'POST' }), deps())
    expect(res.status).toBe(405)
  })

  it('returns 500 and logs when the lookup fails', async () => {
    const log = memoryLog()
    const res = await servePdfRequest(
      request(pdfUrl('doc-1')),
      deps({
        log,
        resolvePath: () => {
          throw new Error('database is closed')
        }
      })
    )
    expect(res.status).toBe(500)
    expect(log.lines[0]?.level).toBe('error')
  })
})

describe('registration', () => {
  it('registers the scheme as privileged with CORS and fetch support', () => {
    const registerSchemesAsPrivileged = vi.fn()
    registerPdfScheme({ registerSchemesAsPrivileged })
    expect(registerSchemesAsPrivileged).toHaveBeenCalledWith([
      {
        scheme: PDF_SCHEME,
        privileges: expect.objectContaining({
          standard: true,
          secure: true,
          supportFetchAPI: true,
          stream: true,
          corsEnabled: true
        })
      }
    ])
  })

  it('installs a protocol handler that serves requests and can be removed', async () => {
    let handler: ((request: Request) => Response | Promise<Response>) | null = null
    const host: PdfProtocolHost = {
      handle: (scheme, h) => {
        expect(scheme).toBe(PDF_SCHEME)
        handler = h
      },
      unhandle: vi.fn()
    }
    const dispose = registerPdfProtocol(host, () => null)
    expect(handler).not.toBeNull()
    const res = await handler!(new Request(pdfUrl('doc-1')))
    expect(res.status).toBe(404)
    dispose()
    expect(host.unhandle).toHaveBeenCalledWith(PDF_SCHEME)
  })
})
