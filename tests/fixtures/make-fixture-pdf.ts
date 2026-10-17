import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'

/**
 * Generates the test fixture PDF (course PDFs are never committed). 12 pages, so the default
 * 10-page chunk grid yields two chunks. Page roles are stable and listed in FIXTURE_PAGES.
 */

export const FIXTURE_TITLE = 'Fixture Course: Optical Links'

export const FIXTURE_PAGES = {
  title: 1,
  text: 2,
  imageOnly: 3,
  formula: 4,
  exercise: 5,
  lastPage: 12
} as const

const BODY: Record<number, string[]> = {
  1: [FIXTURE_TITLE, 'Study notes for automated tests'],
  2: [
    'Total internal reflection',
    'Light stays inside the fibre core because the core refractive index n1 is higher than',
    'the cladding index n2. Rays hitting the boundary above the critical angle are reflected.',
    'Typical attenuation of single-mode fibre is 0.2 dB/km at 1550 nm.'
  ],
  4: [
    'Power budget',
    'P_rx = P_tx - alpha * L - connector losses',
    'P_rx: received power in dBm. P_tx: launch power in dBm.',
    'alpha: fibre attenuation in dB/km. L: link length in km.'
  ],
  5: [
    'Try it',
    'A 50 km link uses fibre with 0.2 dB/km attenuation. What is the fibre loss?',
    'Answer: 0.2 dB/km x 50 km = 10 dB.'
  ]
}

function filler(page: number): string[] {
  return [
    `Section ${page}: dispersion and noise`,
    `Chromatic dispersion broadens pulses; the dispersion limit grows as the bit rate falls (page ${page}).`,
    'Amplifiers add noise; the optical signal-to-noise ratio (OSNR) must exceed the FEC threshold.'
  ]
}

export async function makeFixturePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(FIXTURE_TITLE)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)

  for (let n = 1; n <= FIXTURE_PAGES.lastPage; n++) {
    const page = doc.addPage([720, 540])
    if (n === FIXTURE_PAGES.imageOnly) {
      // Vector "diagram" with no text layer at all.
      page.drawRectangle({ x: 100, y: 200, width: 520, height: 120, color: rgb(0.85, 0.9, 1) })
      page.drawLine({
        start: { x: 110, y: 260 },
        end: { x: 610, y: 260 },
        thickness: 4,
        color: rgb(0.1, 0.3, 0.8)
      })
      page.drawCircle({ x: 360, y: 260, size: 30, color: rgb(1, 0.6, 0.2) })
      continue
    }
    const lines = BODY[n] ?? filler(n)
    lines.forEach((line, i) => {
      page.drawText(line, { x: 48, y: 470 - i * 28, size: i === 0 ? 22 : 13, font: i === 0 ? bold : font })
    })
  }
  return doc.save()
}

/** Writes the fixture into dir and returns its path. */
export async function writeFixturePdf(dir: string, name = 'fixture.pdf'): Promise<string> {
  await mkdir(dir, { recursive: true })
  const path = join(dir, name)
  await writeFile(path, await makeFixturePdf())
  return path
}
