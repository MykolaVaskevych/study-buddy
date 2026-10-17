import { stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { chunksCovering } from './focus'
import { DEFAULT_CHUNK_OPTIONS, FOCUS_CHUNK_INDEX, createPdfLibrary } from './index'
import { makeTempDir, readPdfPages } from './test-pdfs'
import { LibraryError, type ChunkInfo } from './types'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
let n = 0
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(join(tmp.dir, 'src'))
})
afterAll(() => tmp.cleanup())

const newLibrary = (): { library: ReturnType<typeof createPdfLibrary>; root: string } => {
  const root = join(tmp.dir, `lib-${n++}`)
  return {
    library: createPdfLibrary({ rootDir: root, chunk: DEFAULT_CHUNK_OPTIONS }, { inWorker: false }),
    root
  }
}

const stamps = async (path: string): Promise<number[]> =>
  (await readPdfPages(path)).map((p) => Number(/SB-PAGE (\d+)/.exec(p.text)?.[1] ?? 0))

describe('buildFocusChunk', () => {
  it('copies exactly the requested pages, stamps included, across a chunk boundary', async () => {
    const { library, root } = newLibrary()
    const doc = await library.importPdf(fixture)
    const focus = await library.buildFocusChunk(doc.sha256, doc.pageCount, 9, 12)

    expect(focus).toEqual({
      index: FOCUS_CHUNK_INDEX,
      startPage: 9,
      endPage: 12,
      path: join(root, doc.sha256, 'focus', '9-12.pdf'),
      bytes: (await stat(focus.path)).size
    })
    expect(await stamps(focus.path)).toEqual([9, 10, 11, 12])
    // Content comes along with the stamp: page 2 holds the fixture's TIR text.
    const [page2] = await readPdfPages((await library.buildFocusChunk(doc.sha256, 12, 2, 2)).path)
    expect(page2?.text).toContain('Total internal reflection')
    expect(page2?.text).toContain('SB-PAGE 2')
  })

  it('is cached: a second call reuses the file', async () => {
    const { library } = newLibrary()
    const doc = await library.importPdf(fixture)
    const first = await library.buildFocusChunk(doc.sha256, 12, 1, 3)
    const mtime = (await stat(first.path)).mtimeMs
    expect(await library.buildFocusChunk(doc.sha256, 12, 1, 3)).toEqual(first)
    expect((await stat(first.path)).mtimeMs).toBe(mtime)
  })

  it('rebuilds missing grid files first and rejects bad ranges and hashes', async () => {
    const { library } = newLibrary()
    const doc = await library.importPdf(fixture)
    await unlink(doc.chunks[1]?.path ?? '')
    expect(await stamps((await library.buildFocusChunk(doc.sha256, 12, 10, 11)).path)).toEqual([10, 11])

    for (const [from, to] of [
      [0, 2],
      [3, 2],
      [12, 13],
      [1.5, 2]
    ] as const) {
      await expect(library.buildFocusChunk(doc.sha256, 12, from, to)).rejects.toBeInstanceOf(LibraryError)
    }
    await expect(library.buildFocusChunk('../x', 12, 1, 1)).rejects.toMatchObject({ kind: 'io' })
  })

  it('deleteFiles removes cached focus chunks too', async () => {
    const { library } = newLibrary()
    const doc = await library.importPdf(fixture)
    const focus = await library.buildFocusChunk(doc.sha256, 12, 4, 5)
    await library.deleteFiles(doc.sha256)
    await expect(stat(focus.path)).rejects.toThrow()
  })
})

describe('chunksCovering', () => {
  const chunk = (index: number, startPage: number, endPage: number): ChunkInfo => ({
    index,
    startPage,
    endPage,
    path: `/c/${index}.pdf`,
    bytes: 1
  })
  const grid = [chunk(1, 11, 20), chunk(0, 1, 10), chunk(2, 21, 25)]

  it('returns overlapping chunks in page order and refuses gaps', () => {
    expect(chunksCovering(grid, 9, 12).map((c) => c.index)).toEqual([0, 1])
    expect(chunksCovering(grid, 21, 21).map((c) => c.index)).toEqual([2])
    expect(() => chunksCovering(grid, 24, 26)).toThrow(LibraryError)
    expect(() => chunksCovering([chunk(0, 1, 10), chunk(2, 21, 25)], 5, 22)).toThrow(/page 11/)
  })
})
