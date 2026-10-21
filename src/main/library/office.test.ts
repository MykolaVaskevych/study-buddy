import { EventEmitter } from 'node:events'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { createPdfLibrary, DEFAULT_CHUNK_OPTIONS } from './index'
import {
  createOfficeConverter,
  findSoffice,
  sofficeCommand,
  type ChildLike,
  type OfficeConverter
} from './office'
import { makeTempDir } from './test-pdfs'
import { LibraryError } from './types'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(join(tmp.dir, 'src'))
})
afterAll(() => tmp.cleanup())

/** A child process that exits with `code` after optionally writing stderr. */
function fakeChild(code: number | null, stderr = '', error?: NodeJS.ErrnoException): ChildLike {
  const proc = new EventEmitter()
  const err = new EventEmitter()
  setTimeout(() => {
    if (stderr) err.emit('data', Buffer.from(stderr))
    if (error) proc.emit('error', error)
    else proc.emit('close', code)
  }, 1)
  return Object.assign(proc, { stderr: err, kill: () => proc.emit('close', null) }) as unknown as ChildLike
}

describe('soffice', () => {
  it('finds it on PATH, then in the standard places', () => {
    const exists = (p: string): boolean =>
      p === '/opt/bin/soffice' || p === '/usr/lib/libreoffice/program/soffice'
    expect(findSoffice({ PATH: '/opt/bin:/usr/local/bin' }, exists, 'linux')).toBe('/opt/bin/soffice')
    expect(findSoffice({ PATH: '' }, exists, 'linux')).toBe('/usr/lib/libreoffice/program/soffice')
    expect(findSoffice({ PATH: '' }, () => false, 'linux')).toBeNull()
  })

  it('runs headless with a private profile, on the host inside the Flatpak', () => {
    const plain = sofficeCommand('/usr/bin/soffice', '/w/a.pptx', '/w', '/data/lo', false)
    expect(plain.command).toBe('/usr/bin/soffice')
    expect(plain.args).toEqual([
      '-env:UserInstallation=file:///data/lo',
      '--headless',
      '--norestore',
      '--convert-to',
      'pdf',
      '--outdir',
      '/w',
      '/w/a.pptx'
    ])
    const flatpak = sofficeCommand('soffice', '/w/a.pptx', '/w', '/data/lo', true)
    expect(flatpak.command).toBe('flatpak-spawn')
    expect(flatpak.args.slice(0, 6)).toEqual([
      '--host',
      '--watch-bus',
      'sh',
      '-lc',
      'exec soffice "$@"',
      'soffice'
    ])
    expect(flatpak.args.at(-1)).toBe('/w/a.pptx')
  })

  it('reports a missing LibreOffice with an install hint, and failed conversions with the reason', async () => {
    const out = join(tmp.dir, 'out-fail')
    const run = (child: ChildLike, locate: string | null = '/usr/bin/soffice'): Promise<string> =>
      createOfficeConverter({
        locate: () => locate,
        flatpak: false,
        profileDir: '/p',
        spawn: () => child
      }).toPdf('/w/a.pptx', out)
    await expect(run(fakeChild(0), null)).rejects.toMatchObject({
      kind: 'converter_missing',
      message: /libreoffice/i
    })
    const enoent = Object.assign(new Error('spawn soffice ENOENT'), { code: 'ENOENT' })
    await expect(run(fakeChild(null, '', enoent))).rejects.toMatchObject({ kind: 'converter_missing' })
    await expect(run(fakeChild(127))).rejects.toMatchObject({ kind: 'converter_missing' })
    await expect(run(fakeChild(1, 'Error: source file could not be loaded\n'))).rejects.toMatchObject({
      kind: 'conversion_failed',
      message: 'LibreOffice could not convert a.pptx: Error: source file could not be loaded'
    })
    // Exit 0 without a PDF (e.g. a locked profile) is a failure too.
    await expect(run(fakeChild(0))).rejects.toMatchObject({ kind: 'conversion_failed' })
  })

  it('kills a conversion that hangs', async () => {
    const hung = Object.assign(new EventEmitter(), { stderr: null, kill: vi.fn() }) as unknown as ChildLike
    const converter = createOfficeConverter({
      locate: () => '/usr/bin/soffice',
      flatpak: false,
      profileDir: '/p',
      spawn: () => hung,
      timeoutMs: 5
    })
    await expect(converter.toPdf('/w/a.pptx', '/w')).rejects.toMatchObject({ kind: 'conversion_failed' })
    expect(hung.kill).toHaveBeenCalled()
  })
})

describe('importing office files', () => {
  /** Stands in for LibreOffice: "converts" by copying the fixture PDF. */
  const stubConverter = (): OfficeConverter & { calls: string[] } => {
    const calls: string[] = []
    return {
      calls,
      async toPdf(source, outDir) {
        calls.push(source)
        await mkdir(outDir, { recursive: true })
        const pdf = join(outDir, `${basename(source, extname(source))}.pdf`)
        // Different bytes on every run, like LibreOffice.
        await writeFile(pdf, Buffer.concat([await readFile(fixture), Buffer.from(`\n%${calls.length}\n`)]))
        return pdf
      }
    }
  }

  it('converts a deck once, titles it by file name and reuses the PDF on re-import', async () => {
    const root = join(tmp.dir, 'lib-office')
    const converter = stubConverter()
    const library = createPdfLibrary(
      { rootDir: root, chunk: DEFAULT_CHUNK_OPTIONS },
      { inWorker: false, officeConverter: converter }
    )
    const deck = join(tmp.dir, 'src', 'Week 3 - Dispersion.pptx')
    await writeFile(deck, 'pretend pptx bytes')
    const first = await library.importPdf(deck)
    expect(first.title).toBe('Week 3 - Dispersion')
    expect(first.pageCount).toBe(12)
    const again = await library.importPdf(deck)
    expect(again.sha256).toBe(first.sha256)
    expect(converter.calls).toHaveLength(1)
    // The conversion folder is cleaned up.
    expect(await readdir(join(root, 'converting'))).toEqual([])
  })

  it('fails with an install hint when no converter is available', async () => {
    const library = createPdfLibrary(
      { rootDir: join(tmp.dir, 'lib-none'), chunk: DEFAULT_CHUNK_OPTIONS },
      { inWorker: false }
    )
    const doc = join(tmp.dir, 'src', 'notes.docx')
    await writeFile(doc, 'pretend docx bytes')
    const err = await library.importPdf(doc).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(LibraryError)
    expect(err).toMatchObject({ kind: 'converter_missing' })
  })
})
