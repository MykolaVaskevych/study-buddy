import { PDFDocument } from 'pdf-lib'
import { LibraryError } from './types'

/**
 * Photos and screenshots (a whiteboard, handwritten notes) become a PDF with one page per image, so
 * they are read, tested and reviewed like any other file. The pages are image-only; models that
 * read PDFs see the image, text-only models skip it.
 */

/** Long side of a page in PDF points (A4), so a 4000-pixel photo does not become a 1.4 m page. */
const PAGE_LONG_SIDE = 842

/** PNG or JPEG from the file's first bytes; null for anything else (WebP is not supported). */
export function imageKind(bytes: Uint8Array): 'png' | 'jpg' | null {
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return 'png'
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg'
  return null
}

/** One page per image, sized to the image's aspect ratio with its long side at A4 length. */
export async function imagesToPdf(
  images: readonly { name: string; bytes: Uint8Array }[]
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create()
  for (const { name, bytes } of images) {
    const kind = imageKind(bytes)
    if (kind === null) throw new LibraryError('conversion_failed', `${name} is not a PNG or JPEG image`)
    const image = await (kind === 'png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes)).catch((err: unknown) => {
      throw new LibraryError('conversion_failed', `${name} could not be read as an image`, err)
    })
    const scale = PAGE_LONG_SIDE / Math.max(image.width, image.height)
    const width = image.width * scale
    const height = image.height * scale
    pdf.addPage([width, height]).drawImage(image, { x: 0, y: 0, width, height })
  }
  return pdf.save()
}
