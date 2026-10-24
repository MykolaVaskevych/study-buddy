import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { createPdfLibrary, DEFAULT_CHUNK_OPTIONS } from './index'
import { imageKind, imagesToPdf } from './images'
import { makeTempDir } from './test-pdfs'

/** A 2×1 pixel PNG (wider than tall). */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR42mP8z8DwnwEJMDIAAA8+Af9SiVhzAAAAAElFTkSuQmCC',
  'base64'
)

let tmp: Awaited<ReturnType<typeof makeTempDir>>
beforeAll(async () => {
  tmp = await makeTempDir()
})
afterAll(() => tmp.cleanup())

describe('images to PDF', () => {
  it('knows PNG and JPEG by their first bytes and nothing else', () => {
    expect(imageKind(PNG)).toBe('png')
    expect(imageKind(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg')
    expect(imageKind(Buffer.from('RIFF....WEBPVP8 '))).toBeNull()
  })

  it('makes one page per image, keeping the aspect ratio at A4 length', async () => {
    const pdf = await PDFDocument.load(
      await imagesToPdf([
        { name: 'a.png', bytes: PNG },
        { name: 'b.png', bytes: PNG }
      ])
    )
    expect(pdf.getPageCount()).toBe(2)
    const { width, height } = pdf.getPage(0).getSize()
    expect(Math.round(width)).toBe(842)
    expect(Math.round(height)).toBe(421)
    await expect(imagesToPdf([{ name: 'x.webp', bytes: Buffer.from('RIFF....WEBP') }])).rejects.toMatchObject(
      {
        kind: 'conversion_failed'
      }
    )
  })

  it('imports a photo as a one-page, image-only document named after the file', async () => {
    const library = createPdfLibrary(
      { rootDir: join(tmp.dir, 'lib-img'), chunk: DEFAULT_CHUNK_OPTIONS },
      { inWorker: false }
    )
    const photo = join(tmp.dir, 'Whiteboard week 5.png')
    await writeFile(photo, PNG)
    const doc = await library.importPdf(photo)
    expect(doc).toMatchObject({ title: 'Whiteboard week 5', pageCount: 1 })
    expect(doc.pages[0]?.hasTextLayer).toBe(false)
    expect((await library.importPdf(photo)).sha256).toBe(doc.sha256)
  })
})
