import { copyFile, readdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import {
  FIXTURE_PAGES,
  FIXTURE_TITLE,
  makeFixturePdf,
  writeFixturePdf
} from '../../../tests/fixtures/make-fixture-pdf'
import { DEFAULT_CHUNK_OPTIONS, createPdfLibrary } from './index'
import { hashFile } from './store'
import { makeEncryptedPdf, makeTempDir, readPdfPages } from './test-pdfs'
import { LibraryError, type LibraryConfig } from './types'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
let n = 0
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(join(tmp.dir, 'src'))
})
afterAll(() => tmp.cleanup())

const config = (): LibraryConfig => ({ rootDir: join(tmp.dir, `lib-${n++}`), chunk: DEFAULT_CHUNK_OPTIONS })

// Uses the real worker thread (the app's path) unless stated otherwise.
describe('createPdfLibrary.importPdf', () => {
  it('imports the fixture: pages, title, text layers and a stamped 10-page chunk grid', async () => {
    const cfg = config()
    const library = createPdfLibrary(cfg)
    const doc = await library.importPdf(fixture)

    expect(doc.sha256).toBe(await hashFile(fixture))
    expect(doc.storedPath).toBe(join(cfg.rootDir, `${doc.sha256}.pdf`))
    expect(library.storedPath(doc.sha256)).toBe(doc.storedPath)
    expect(await readFile(doc.storedPath)).toEqual(await readFile(fixture))
    expect(doc.pageCount).toBe(12)
    expect(doc.pages).toHaveLength(12)
    expect(doc.title).toBe(FIXTURE_TITLE)
    expect(doc.pages[FIXTURE_PAGES.text - 1]?.text).toContain('Total internal reflection')
    expect(doc.pages[FIXTURE_PAGES.imageOnly - 1]?.hasTextLayer).toBe(false)

    expect(doc.chunks.map((c) => [c.index, c.startPage, c.endPage])).toEqual([
      [0, 1, 10],
      [1, 11, 12]
    ])
    for (const chunk of doc.chunks) {
      expect(chunk.path).toBe(join(cfg.rootDir, doc.sha256, 'chunks', `${chunk.index}.pdf`))
      expect(chunk.bytes).toBe((await stat(chunk.path)).size)
      const pdf = await PDFDocument.load(await readFile(chunk.path))
      expect(pdf.getPageCount()).toBe(chunk.endPage - chunk.startPage + 1)
    }
    const second = await readPdfPages(doc.chunks[1]?.path ?? '')
    expect(second[0]?.text).toContain('SB-PAGE 11')
    expect(second[1]?.text).toContain('SB-PAGE 12')
  })

  it('is idempotent: same sha, same result, no files rewritten', async () => {
    const library = createPdfLibrary(config())
    const first = await library.importPdf(fixture)
    const mtimes = async (): Promise<number[]> =>
      Promise.all(
        [first.storedPath, ...first.chunks.map((c) => c.path)].map(async (p) => (await stat(p)).mtimeMs)
      )
    const before = await mtimes()

    const copy = join(tmp.dir, 'src', 'renamed-copy.pdf')
    await copyFile(fixture, copy)
    expect(await library.importPdf(fixture)).toEqual(first)
    expect((await library.importPdf(copy)).sha256).toBe(first.sha256)
    expect(await mtimes()).toEqual(before)
  })

  it('works in-process too', async () => {
    const doc = await createPdfLibrary(config(), { inWorker: false }).importPdf(fixture)
    expect(doc.pageCount).toBe(12)
  })

  it('maps bad input to error kinds and leaves no files behind', async () => {
    const cfg = config()
    const library = createPdfLibrary(cfg)
    const write = async (name: string, data: string | Uint8Array): Promise<string> => {
      const path = join(tmp.dir, 'src', name)
      await writeFile(path, data)
      return path
    }
    const kindOf = (path: string, lib = library): Promise<unknown> =>
      lib.importPdf(path).then(
        () => 'imported',
        (e: unknown) => (e instanceof LibraryError ? e.kind : e)
      )

    expect(await kindOf(await write('notes.dat', 'just some text, definitely not a PDF'))).toBe('not_pdf')
    expect(await kindOf(await write('corrupt.pdf', '%PDF-1.7\n' + 'garbage\n'.repeat(100)))).toBe('corrupt')
    const truncated = (await makeFixturePdf()).slice(0, 2000)
    expect(await kindOf(await write('truncated.pdf', truncated))).toBe('corrupt')
    expect(await kindOf(await write('locked.pdf', await makeEncryptedPdf()))).toBe('encrypted')
    expect(await kindOf(join(tmp.dir, 'does-not-exist.pdf'))).toBe('io')
    expect(await kindOf(fixture, createPdfLibrary(cfg, { maxPdfBytes: 1000 }))).toBe('too_large')
    expect(await readdir(cfg.rootDir)).toEqual([])
  })
})

describe('createPdfLibrary file management', () => {
  it('ensureChunks restores a deleted chunk and returns the grid', async () => {
    const library = createPdfLibrary(config())
    const doc = await library.importPdf(fixture)
    const victim = doc.chunks[1]?.path ?? ''
    await unlink(victim)
    const chunks = await library.ensureChunks(doc.sha256, doc.pageCount)
    expect(chunks).toEqual(doc.chunks)
    expect((await stat(victim)).size).toBe(doc.chunks[1]?.bytes)
  })

  it('deleteFiles removes the stored PDF and its chunks; a later import starts over', async () => {
    const cfg = config()
    const library = createPdfLibrary(cfg)
    const doc = await library.importPdf(fixture)
    await library.deleteFiles(doc.sha256)
    expect(await readdir(cfg.rootDir)).toEqual([])
    await expect(library.ensureChunks(doc.sha256, doc.pageCount)).rejects.toMatchObject({ kind: 'io' })
    expect((await library.importPdf(fixture)).chunks).toHaveLength(2)
  })

  it('rejects hashes that are not sha256 hex before touching the filesystem', async () => {
    const library = createPdfLibrary(config())
    expect(() => library.storedPath('../etc')).toThrow(LibraryError)
    await expect(library.deleteFiles('..')).rejects.toMatchObject({ kind: 'io' })
    await expect(library.ensureChunks('x', 1)).rejects.toMatchObject({ kind: 'io' })
  })

  it('rejects nonsensical chunk options', () => {
    expect(() =>
      createPdfLibrary({ rootDir: tmp.dir, chunk: { pagesPerChunk: 0, maxChunkBytes: 1 } })
    ).toThrow(RangeError)
  })
})
