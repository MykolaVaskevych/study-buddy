import { createHash } from 'node:crypto'
import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { hasPdfHeader, storeSourcePdf } from './store'
import { makeTempDir } from './test-pdfs'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
beforeAll(async () => {
  tmp = await makeTempDir()
})
afterAll(() => tmp.cleanup())

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s)

describe('hasPdfHeader', () => {
  it('finds %PDF- at the start or after leading junk', () => {
    expect(hasPdfHeader(bytes('%PDF-1.4\n...'))).toBe(true)
    expect(hasPdfHeader(bytes('junk\n%PDF-2.0'))).toBe(true)
    expect(hasPdfHeader(bytes('%PDF'))).toBe(false)
    expect(hasPdfHeader(bytes('PK\u0003\u0004'))).toBe(false)
  })
})

describe('storeSourcePdf', () => {
  it('stores the file under its sha256 and reuses an existing copy', async () => {
    const source = join(tmp.dir, 'a.pdf')
    const content = '%PDF-1.7\n' + 'x'.repeat(200_000)
    await writeFile(source, content)
    const root = join(tmp.dir, 'lib')
    const sha = createHash('sha256').update(content).digest('hex')

    const first = await storeSourcePdf(source, root, 1e9)
    expect(first).toEqual({ sha256: sha, storedPath: join(root, `${sha}.pdf`) })
    expect(await readFile(first.storedPath, 'utf8')).toBe(content)
    const mtime = (await stat(first.storedPath)).mtimeMs
    expect(await storeSourcePdf(source, root, 1e9)).toEqual(first)
    expect((await stat(first.storedPath)).mtimeMs).toBe(mtime)
  })

  it('checks size before reading and the header before copying', async () => {
    const source = join(tmp.dir, 'b.pdf')
    await writeFile(source, '%PDF-1.7\nabc')
    await expect(storeSourcePdf(source, join(tmp.dir, 'lib2'), 5)).rejects.toMatchObject({
      kind: 'too_large'
    })
    await writeFile(source, '<html></html>')
    await expect(storeSourcePdf(source, join(tmp.dir, 'lib2'), 1e9)).rejects.toMatchObject({
      kind: 'not_pdf'
    })
    await expect(storeSourcePdf(tmp.dir, join(tmp.dir, 'lib2'), 1e9)).rejects.toMatchObject({ kind: 'io' })
  })
})
