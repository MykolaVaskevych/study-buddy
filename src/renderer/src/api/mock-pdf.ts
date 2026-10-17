import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import type { PDFFont, PDFPage } from 'pdf-lib'
import type { BookSpec } from './mock-data'
import { slideFor } from './mock-data'

/**
 * Generates a lecture-slide PDF for a mock book at runtime (PDFs are never committed). Text is
 * real PDF text, so the pdf.js text layer and selection work in browser mode.
 */

const W = 720
const H = 540
const INK = rgb(0.1, 0.14, 0.24)
const GREY = rgb(0.38, 0.42, 0.5)
const ACCENT = rgb(0.17, 0.29, 0.8)

const greek: Record<string, string> = {
  α: 'alpha',
  θ: 'theta',
  λ: 'lambda',
  Δ: 'Delta',
  η: 'eta',
  ν: 'nu',
  π: 'pi',
  τ: 'tau',
  '≈': '~',
  '≤': '<=',
  '≥': '>=',
  '−': '-',
  '’': "'",
  '–': '-',
  '·': '*',
  '×': 'x'
}

/** Standard fonts only encode WinAnsi; strip markdown/LaTeX markup and map the rest to ASCII. */
export function toPdfText(text: string): string {
  return text
    .replace(/\*\*/g, '')
    .replace(/\$([^$]*)\$/g, (_m, tex: string) =>
      tex
        .replace(/\\(?:mathrm|text)\{([^}]*)\}/g, '$1')
        .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1)/($2)')
        .replace(/\\([a-zA-Z]+)/g, '$1')
        .replace(/[{}]/g, '')
    )
    .replace(/./gu, (ch) => greek[ch] ?? ((ch.codePointAt(0) ?? 0) > 0xff ? '?' : ch))
}

function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = []
  let line = ''
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line)
      line = word
    } else line = next
  }
  if (line) lines.push(line)
  return lines
}

function drawDiagram(page: PDFPage, variant: number): void {
  if (variant % 3 === 0) {
    // Fibre cross-section: cladding and core.
    page.drawCircle({ x: 590, y: 250, size: 70, color: rgb(0.86, 0.9, 0.98) })
    page.drawCircle({ x: 590, y: 250, size: 22, color: rgb(0.55, 0.66, 0.95) })
  } else if (variant % 3 === 1) {
    // Link: Tx -> fibre -> Rx.
    page.drawRectangle({ x: 470, y: 230, width: 60, height: 40, borderColor: INK, borderWidth: 1.5 })
    page.drawRectangle({ x: 620, y: 230, width: 60, height: 40, borderColor: INK, borderWidth: 1.5 })
    page.drawLine({ start: { x: 530, y: 250 }, end: { x: 620, y: 250 }, thickness: 3, color: ACCENT })
  } else {
    // A decaying power curve.
    page.drawLine({ start: { x: 470, y: 170 }, end: { x: 690, y: 170 }, thickness: 1, color: GREY })
    page.drawLine({ start: { x: 470, y: 170 }, end: { x: 470, y: 330 }, thickness: 1, color: GREY })
    page.drawSvgPath('M 0 0 C 60 110 120 140 210 150', {
      x: 475,
      y: 320,
      borderColor: ACCENT,
      borderWidth: 2
    })
  }
}

/** Builds the full slide deck for a book. ~146 pages take well under a second. */
export async function makeBookPdf(book: BookSpec): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(book.title)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (let n = 1; n <= book.pageCount; n++) {
    const page = doc.addPage([W, H])
    const slide = slideFor(book, n)
    if (slide.kind === 'title') {
      page.drawText(toPdfText(book.title), { x: 56, y: 300, size: 34, font: bold, color: INK })
      page.drawText('Lecture slides', { x: 56, y: 262, size: 16, font, color: GREY })
      continue
    }
    page.drawRectangle({ x: 0, y: H - 8, width: W, height: 8, color: ACCENT })
    page.drawText(toPdfText(slide.title || 'Notes'), { x: 48, y: H - 64, size: 24, font: bold, color: INK })
    if (slide.topic) page.drawText(toPdfText(slide.topic), { x: 48, y: H - 88, size: 11, font, color: GREY })

    const textWidth = slide.kind === 'toc' ? 620 : 390
    let y = H - 130
    const bullets = [slide.summary, ...slide.keyPoints].filter(Boolean)
    for (const [i, raw] of bullets.entries()) {
      const size = i === 0 && slide.summary ? 15 : 13
      for (const [j, line] of wrap(toPdfText(raw), font, size, textWidth).entries()) {
        if (y < 70) break
        page.drawText(j === 0 && i > 0 ? `-  ${line}` : i > 0 ? `   ${line}` : line, {
          x: 48,
          y,
          size,
          font,
          color: i === 0 ? INK : GREY
        })
        y -= size + 7
      }
      y -= 8
    }
    for (const formula of slide.formulas ?? []) {
      if (y < 80) break
      page.drawText(toPdfText(`$${formula.latex}$`), { x: 64, y, size: 15, font: bold, color: ACCENT })
      y -= 30
    }
    if (slide.kind !== 'toc') drawDiagram(page, n)
    page.drawText(toPdfText(book.title), { x: 48, y: 24, size: 9, font, color: GREY })
    page.drawText(`${n} / ${book.pageCount}`, { x: W - 90, y: 24, size: 9, font, color: GREY })
  }
  return doc.save()
}
