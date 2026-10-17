import { join } from 'node:path'
import { FIXTURE_PAGES, FIXTURE_TITLE, writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { extractPdfData, extractPdfFile } from './extract'
import { countOutlineItems, resolveOutline } from './outline'
import { makeEncryptedPdf, makeOutlinedPdf, makeTempDir } from './test-pdfs'
import { LibraryError } from './types'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
beforeAll(async () => {
  tmp = await makeTempDir()
})
afterAll(() => tmp.cleanup())

describe('extractPdfFile (fixture)', () => {
  it('extracts pages, title and text layers', async () => {
    const result = await extractPdfFile(await writeFixturePdf(tmp.dir), 'fixture.pdf')
    expect(result.pageCount).toBe(FIXTURE_PAGES.lastPage)
    expect(result.pages.map((p) => p.page)).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(result.title).toBe(FIXTURE_TITLE)
    const text = result.pages[FIXTURE_PAGES.text - 1]
    expect(text?.text).toContain('Total internal reflection')
    expect(text?.text.split('\n')[0]).toBe('Total internal reflection')
    expect(text?.charCount).toBe(text?.text.length)
    expect(text?.hasTextLayer).toBe(true)
    expect(result.pages[FIXTURE_PAGES.imageOnly - 1]).toMatchObject({
      text: '',
      charCount: 0,
      hasTextLayer: false
    })
    expect(result.pages[0]?.label).toBeNull()
    expect(result.outline).toEqual([])
  })
})

describe('extractPdfData', () => {
  it('resolves the outline tree and page labels', async () => {
    const result = await extractPdfData(await makeOutlinedPdf(), 'outlined.pdf')
    expect(result.pages.map((p) => p.label)).toEqual(['i', 'ii', '1', '2'])
    expect(result.outline).toEqual([
      { title: 'Preface', page: 2, children: [] },
      { title: 'Chapter 1', page: 3, children: [{ title: 'Section 1.1', page: 4, children: [] }] },
      { title: 'Website', page: null, children: [] }
    ])
    expect(countOutlineItems(result.outline)).toBe(4)
  })

  it('falls back to the first meaningful line of page 1 for the title', async () => {
    const result = await extractPdfData(await makeOutlinedPdf(), 'outlined.pdf')
    expect(result.title).toBe('Body text of page 1 with enough characters to count as a text layer.')
  })

  it('reports password-protected files as encrypted', async () => {
    await expect(extractPdfData(await makeEncryptedPdf(), 'locked.pdf')).rejects.toMatchObject({
      name: 'LibraryError',
      kind: 'encrypted'
    })
  })

  it('reports garbage after a PDF header as corrupt', async () => {
    const bytes = new TextEncoder().encode('%PDF-1.7\n' + 'not really a pdf\n'.repeat(50))
    const error: unknown = await extractPdfData(bytes, 'bad.pdf').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(LibraryError)
    expect(error).toMatchObject({ kind: 'corrupt' })
  })

  it('reports an unreadable path as io', async () => {
    await expect(extractPdfFile(join(tmp.dir, 'missing.pdf'), 'missing.pdf')).rejects.toMatchObject({
      kind: 'io'
    })
  })
})

describe('resolveOutline', () => {
  it('keeps the tree and turns resolver failures into page null', async () => {
    const outline = await resolveOutline(
      [
        { title: ' A ', dest: 'a', items: [{ title: 'A.1', dest: 'boom', items: [] }] },
        { title: 'B', dest: null, items: [] }
      ],
      async (dest) => {
        if (dest === 'boom') throw new Error('dangling')
        return 7
      }
    )
    expect(outline).toEqual([
      { title: 'A', page: 7, children: [{ title: 'A.1', page: null, children: [] }] },
      { title: 'B', page: null, children: [] }
    ])
  })
})
