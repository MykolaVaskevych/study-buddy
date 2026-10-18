import { join } from 'node:path'
import { FIXTURE_PAGES, writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { DEFAULT_CHUNK_OPTIONS, createPdfLibrary, splitStamp } from './index'
import { makeTempDir } from './test-pdfs'
import { LibraryError } from './types'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(join(tmp.dir, 'src'))
})
afterAll(() => tmp.cleanup())

describe('splitStamp', () => {
  it('takes the absolute page from the stamp and drops it from the text', () => {
    expect(splitStamp('Snell law relates the angles of incidence and refraction. SB-PAGE 17')).toEqual({
      page: 17,
      text: 'Snell law relates the angles of incidence and refraction.',
      hasTextLayer: true
    })
  })

  it('treats a page holding only the stamp as image-only', () => {
    expect(splitStamp('SB-PAGE 3')).toEqual({ page: 3, text: '', hasTextLayer: false })
    expect(splitStamp('no stamp here')).toMatchObject({ page: null, text: 'no stamp here' })
  })
})

describe('pageTexts', () => {
  it('reads a chunk page by page with absolute stamps, and serves repeats from the cache', async () => {
    const library = createPdfLibrary(
      { rootDir: join(tmp.dir, 'lib'), chunk: DEFAULT_CHUNK_OPTIONS },
      { inWorker: false }
    )
    const doc = await library.importPdf(fixture)
    const second = doc.chunks[1]!
    const pages = await library.pageTexts(second.path)
    expect(pages.map((p) => p.page)).toEqual([11, 12])
    expect(pages.every((p) => !p.text.includes('SB-PAGE'))).toBe(true)
    const imageOnly = FIXTURE_PAGES.imageOnly
    const first = await library.pageTexts(doc.chunks[0]!.path)
    expect(first[imageOnly - 1]).toMatchObject({ page: imageOnly, hasTextLayer: false })
    expect(await library.pageTexts(second.path)).toBe(pages)
  })

  it('fails with a LibraryError for a missing file', async () => {
    const library = createPdfLibrary({ rootDir: join(tmp.dir, 'lib2'), chunk: DEFAULT_CHUNK_OPTIONS })
    await expect(library.pageTexts(join(tmp.dir, 'nope.pdf'))).rejects.toBeInstanceOf(LibraryError)
  })
})
