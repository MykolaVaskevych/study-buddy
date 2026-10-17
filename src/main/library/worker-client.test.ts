import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { runPdfJob, unwrapWorkerReply, type PdfJob } from './job'
import { makeTempDir } from './test-pdfs'
import { LibraryError } from './types'
import { locateWorkerEntry, runPdfJobInWorker } from './worker-client'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(tmp.dir)
})
afterAll(() => tmp.cleanup())

const job = (pdfPath: string, dir: string): PdfJob => ({
  pdfPath,
  extract: { fileName: 'fixture.pdf' },
  chunks: { dir, options: { pagesPerChunk: 10, maxChunkBytes: 20 * 1024 * 1024 }, expectedPageCount: null }
})

describe('locateWorkerEntry', () => {
  const only =
    (...paths: string[]) =>
    (p: string): boolean =>
      paths.includes(p)

  it('prefers the bundled sibling, then the parent dir, then the TS source', () => {
    expect(locateWorkerEntry('/app/out/main', only('/app/out/main/pdf-worker.js'))).toEqual({
      kind: 'bundled',
      path: '/app/out/main/pdf-worker.js'
    })
    expect(locateWorkerEntry('/app/out/main/chunks', only('/app/out/main/pdf-worker.js'))?.kind).toBe(
      'bundled'
    )
    expect(locateWorkerEntry('/src/lib', only('/src/lib/pdf-worker.ts'))).toEqual({
      kind: 'source',
      path: '/src/lib/pdf-worker.ts'
    })
    expect(locateWorkerEntry('/nowhere', only())).toBeNull()
  })
})

// The real worker thread, running the TS sources through tsx (see spawnWorker).
describe('runPdfJobInWorker', () => {
  it('returns the same result as the in-process job', async () => {
    const inWorker = await runPdfJobInWorker(job(fixture, join(tmp.dir, 'a')), 60_000)
    const inProcess = await runPdfJob(job(fixture, join(tmp.dir, 'b')))
    expect(inWorker.extract).toEqual(inProcess.extract)
    expect(inWorker.chunks?.map((c) => [c.startPage, c.endPage, c.bytes])).toEqual(
      inProcess.chunks?.map((c) => [c.startPage, c.endPage, c.bytes])
    )
  })

  it('carries LibraryError kinds across the thread boundary', async () => {
    const bad = join(tmp.dir, 'bad.pdf')
    await writeFile(bad, '%PDF-1.7\ngarbage\n')
    const error: unknown = await runPdfJobInWorker(job(bad, join(tmp.dir, 'c')), 60_000).catch(
      (e: unknown) => e
    )
    expect(error).toBeInstanceOf(LibraryError)
    expect(error).toMatchObject({ kind: 'corrupt' })
  })

  it('kills a worker that exceeds the timeout', async () => {
    await expect(runPdfJobInWorker(job(fixture, join(tmp.dir, 'd')), 1)).rejects.toMatchObject({
      kind: 'corrupt',
      message: expect.stringContaining('did not finish') as unknown
    })
  })
})

describe('unwrapWorkerReply', () => {
  it('rejects malformed replies', () => {
    expect(() => unwrapWorkerReply(null)).toThrow(LibraryError)
    expect(() => unwrapWorkerReply({ ok: true, result: { extract: 1, chunks: null } })).toThrow(
      /invalid result/
    )
    expect(() => unwrapWorkerReply({ ok: false, error: { kind: 'too_large', message: 'big' } })).toThrow(
      'big'
    )
  })
})
