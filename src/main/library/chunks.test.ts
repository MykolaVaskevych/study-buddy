import { readFile, stat, truncate, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDict, PDFDocument, PDFName, concatTransformationMatrix } from 'pdf-lib'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { detachCrossPageReferences, ensureChunkFiles, readCompleteChunkGrid, renderChunk } from './chunks'
import { makeCrossLinkedPdf, makeEncryptedPdf, makeTempDir, makeTextPdf, readPdfPages } from './test-pdfs'
import type { ChunkOptions } from './types'

const OPTIONS: ChunkOptions = { pagesPerChunk: 10, maxChunkBytes: 20 * 1024 * 1024 }

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(tmp.dir)
})
afterAll(() => tmp.cleanup())

let n = 0
const freshDir = (): string => join(tmp.dir, `chunks-${n++}`)

describe('renderChunk stamp', () => {
  it('puts an upright stamp in the displayed bottom-right corner, whatever the rotation, crop or CTM', async () => {
    const doc = await makeTextPdf(5, [0, 90, 180, 270, 0])
    doc.getPage(4).setCropBox(50, 50, 400, 300)
    // Leaves a scaled CTM behind, as some generators do; the stamp must not inherit it.
    doc.getPage(0).pushOperators(concatTransformationMatrix(0.25, 0, 0, 0.25, 0, 0))
    const source = await PDFDocument.load(await doc.save())
    const path = join(tmp.dir, 'stamped.pdf')
    await writeFile(path, await renderChunk(source, { startPage: 1, endPage: 5 }))

    const pages = await readPdfPages(path)
    pages.forEach((page, i) => {
      const stamp = page.items.find((item) => item.str === `SB-PAGE ${i + 1}`)
      expect(stamp, `page ${i + 1}`).toBeDefined()
      expect(stamp?.upright).toBe(true)
      expect(stamp?.x).toBeGreaterThan(page.width - 60)
      expect(stamp?.x).toBeLessThan(page.width - 30)
      expect(stamp?.y).toBeCloseTo(page.height - 4, 0)
    })
  })
})

describe('detachCrossPageReferences', () => {
  it('keeps links and back-pointers from copying other pages into a chunk', async () => {
    const source = await PDFDocument.load(await makeCrossLinkedPdf())
    detachCrossPageReferences(source)
    const chunk = await PDFDocument.load(await renderChunk(source, { startPage: 1, endPage: 2 }))
    const pageObjects = chunk.context
      .enumerateIndirectObjects()
      .filter(([, obj]) => obj instanceof PDFDict && obj.get(PDFName.Type) === PDFName.of('Page'))
    expect(pageObjects).toHaveLength(2)
    // The note survives (minus /P); the link is gone.
    expect(chunk.getPage(0).node.Annots()?.size()).toBe(1)
  })
})

describe('ensureChunkFiles', () => {
  it('builds the default grid with a manifest', async () => {
    const dir = freshDir()
    const chunks = await ensureChunkFiles(fixture, { dir, options: OPTIONS, expectedPageCount: 12 })
    expect(chunks.map((c) => [c.index, c.startPage, c.endPage])).toEqual([
      [0, 1, 10],
      [1, 11, 12]
    ])
    expect(await readCompleteChunkGrid(dir, 12, OPTIONS)).toEqual(chunks)
    expect(await readCompleteChunkGrid(dir, 12, { ...OPTIONS, pagesPerChunk: 5 })).toBeNull()
  })

  it('splits oversized chunks in halves down to single pages', async () => {
    const chunks = await ensureChunkFiles(fixture, {
      dir: freshDir(),
      options: { pagesPerChunk: 10, maxChunkBytes: 1 },
      expectedPageCount: null
    })
    expect(chunks.map((c) => [c.startPage, c.endPage])).toEqual(
      Array.from({ length: 12 }, (_, i) => [i + 1, i + 1])
    )
    const last = await readPdfPages(chunks[11]?.path ?? '')
    expect(last[0]?.text).toContain('SB-PAGE 12')
  })

  it('repairs only missing or truncated files and rebuilds when the options change', async () => {
    const dir = freshDir()
    const job = { dir, options: OPTIONS, expectedPageCount: 12 }
    const [first, second] = await ensureChunkFiles(fixture, job)
    const original = await readFile(first?.path ?? '')
    const secondMtime = (await stat(second?.path ?? '')).mtimeMs

    await unlink(first?.path ?? '')
    expect(await readCompleteChunkGrid(dir, 12, OPTIONS)).toBeNull()
    await ensureChunkFiles(fixture, job)
    expect(await readFile(first?.path ?? '')).toEqual(original)
    expect((await stat(second?.path ?? '')).mtimeMs).toBe(secondMtime)

    await truncate(second?.path ?? '', 10)
    const repaired = await ensureChunkFiles(fixture, job)
    expect(await readCompleteChunkGrid(dir, 12, OPTIONS)).toEqual(repaired)

    const single = await ensureChunkFiles(fixture, { ...job, options: { ...OPTIONS, pagesPerChunk: 12 } })
    expect(single.map((c) => [c.startPage, c.endPage])).toEqual([[1, 12]])
    await expect(stat(join(dir, '1.pdf'))).rejects.toThrow()
  })

  it('rejects a page count that does not match the file', async () => {
    await expect(
      ensureChunkFiles(fixture, { dir: freshDir(), options: OPTIONS, expectedPageCount: 11 })
    ).rejects.toMatchObject({ kind: 'corrupt' })
  })

  it('rejects encrypted sources, which pdf-lib cannot decrypt', async () => {
    const path = join(tmp.dir, 'locked.pdf')
    await writeFile(path, await makeEncryptedPdf())
    await expect(
      ensureChunkFiles(path, { dir: freshDir(), options: OPTIONS, expectedPageCount: null })
    ).rejects.toMatchObject({
      kind: 'encrypted'
    })
  })
})
