import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getDocument, Util } from 'pdfjs-dist/legacy/build/pdf.mjs'
import { PDFDocument, PDFHexString, PDFName, PDFString, StandardFonts, degrees, type PDFRef } from 'pdf-lib'

/**
 * Test-only helpers (imported by *.test.ts only): temp dirs, special PDFs the shared fixture does not
 * cover (outline, labels, encryption, rotation, cross-page links) and a pdf.js reader for chunk output.
 */

export async function makeTempDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), 'sb-library-'))
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) }
}

/** Plain text pages; `rotations[i]` sets /Rotate of page i+1. */
export async function makeTextPdf(pageCount: number, rotations: number[] = []): Promise<PDFDocument> {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  for (let n = 1; n <= pageCount; n++) {
    const page = doc.addPage([600, 400])
    page.setRotation(degrees(rotations[n - 1] ?? 0))
    page.drawText(`Body text of page ${n} with enough characters to count as a text layer.`, {
      x: 40,
      y: 300,
      size: 12,
      font
    })
  }
  return doc
}

/**
 * 4 pages with page labels (i, ii, 1, 2) and an outline: an explicit destination, a named destination
 * with a nested child, and an entry with no destination.
 */
export async function makeOutlinedPdf(): Promise<Uint8Array> {
  const doc = await makeTextPdf(4)
  const ctx = doc.context
  const pageRefs = doc.getPages().map((p) => p.ref)
  const ref = (i: number): PDFRef => pageRefs[i] ?? pageRefs[0] ?? ctx.nextRef()

  doc.catalog.set(
    PDFName.of('PageLabels'),
    ctx.obj({ Nums: [0, ctx.obj({ S: 'r' }), 2, ctx.obj({ S: 'D', St: 1 })] })
  )
  doc.catalog.set(PDFName.of('Dests'), ctx.obj({ intro: [ref(2), PDFName.of('Fit')] }))

  const outlinesRef = ctx.nextRef()
  const [first, second, child, third] = [ctx.nextRef(), ctx.nextRef(), ctx.nextRef(), ctx.nextRef()]
  ctx.assign(
    first,
    ctx.obj({
      Title: PDFString.of('Preface'),
      Parent: outlinesRef,
      Next: second,
      Dest: [ref(1), PDFName.of('Fit')]
    })
  )
  ctx.assign(
    second,
    ctx.obj({
      Title: PDFString.of('Chapter   1'),
      Parent: outlinesRef,
      Prev: first,
      Next: third,
      Dest: PDFString.of('intro'),
      First: child,
      Last: child,
      Count: 1
    })
  )
  ctx.assign(
    child,
    ctx.obj({
      Title: PDFString.of('Section 1.1'),
      Parent: second,
      Dest: [ref(3), PDFName.of('XYZ'), null, null, null]
    })
  )
  ctx.assign(third, ctx.obj({ Title: PDFString.of('Website'), Parent: outlinesRef, Prev: second }))
  ctx.assign(outlinesRef, ctx.obj({ Type: 'Outlines', First: first, Last: third, Count: 3 }))
  doc.catalog.set(PDFName.of('Outlines'), outlinesRef)
  return doc.save()
}

/**
 * A PDF with a Standard security handler whose /U and /O match no password, so pdf.js asks for one
 * (PasswordException) and pdf-lib sees /Encrypt. Content is not really encrypted; it never gets read.
 */
export async function makeEncryptedPdf(): Promise<Uint8Array> {
  const doc = await makeTextPdf(2)
  const ctx = doc.context
  const junk = (byte: string): PDFHexString => PDFHexString.of(byte.repeat(32))
  ctx.trailerInfo.Encrypt = ctx.obj({
    Filter: 'Standard',
    V: 1,
    R: 2,
    Length: 40,
    O: junk('ab'),
    U: junk('cd'),
    P: -4
  })
  ctx.trailerInfo.ID = ctx.obj([junk('01'), junk('01')])
  return doc.save({ useObjectStreams: false })
}

/**
 * 12 pages where page 1 links to page 12 (explicit destination) and carries a note annotation with a /P
 * back-pointer: both would make a naive page copy drag the whole document into every chunk.
 */
export async function makeCrossLinkedPdf(): Promise<Uint8Array> {
  const doc = await makeTextPdf(12)
  const ctx = doc.context
  const [firstPage, lastPage] = [doc.getPage(0), doc.getPage(11)]
  const link = ctx.register(
    ctx.obj({ Type: 'Annot', Subtype: 'Link', Rect: [0, 0, 50, 50], Dest: [lastPage.ref, PDFName.of('Fit')] })
  )
  const note = ctx.register(
    ctx.obj({
      Type: 'Annot',
      Subtype: 'Text',
      Rect: [60, 0, 80, 20],
      P: firstPage.ref,
      Contents: PDFString.of('n')
    })
  )
  firstPage.node.set(PDFName.Annots, ctx.obj([link, note]))
  return doc.save()
}

export interface PageTextItem {
  str: string
  /** Origin in viewport pixels (scale 1, y down), after /Rotate and the CropBox are applied. */
  x: number
  y: number
  /** True when the text runs left-to-right on the displayed page. */
  upright: boolean
}

export interface ReadPage {
  text: string
  width: number
  height: number
  items: PageTextItem[]
}

/** Reads every page of a PDF file the way a viewer displays it. */
export async function readPdfPages(path: string): Promise<ReadPage[]> {
  const task = getDocument({
    data: new Uint8Array(await readFile(path)),
    verbosity: 0,
    disableFontFace: true
  })
  try {
    const doc = await task.promise
    const pages: ReadPage[] = []
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const items: PageTextItem[] = []
      for (const item of content.items) {
        if (!('str' in item) || item.str.length === 0) continue
        const m = Util.transform(viewport.transform, item.transform)
        items.push({
          str: item.str,
          x: m[4] ?? 0,
          y: m[5] ?? 0,
          upright: (m[0] ?? 0) > 0 && Math.abs(m[1] ?? 0) < 1e-6
        })
      }
      pages.push({
        text: items.map((i) => i.str).join(' '),
        width: viewport.width,
        height: viewport.height,
        items
      })
    }
    return pages
  } finally {
    await task.destroy()
  }
}
