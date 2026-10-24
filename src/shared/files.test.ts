import { isImportable, needsConversion } from './files'

describe('importable files', () => {
  it('accepts PDFs and office files by extension, case-insensitively', () => {
    expect(isImportable('/a/Week 3.PPTX')).toBe(true)
    expect(isImportable('notes.pdf')).toBe(true)
    expect(isImportable('photo.JPG')).toBe(true)
    expect(isImportable('photo.webp')).toBe(false)
    expect(isImportable('pptx')).toBe(false)
    expect(needsConversion('C:\\u\\lecture.docx')).toBe(true)
    expect(needsConversion('notes.pdf')).toBe(false)
  })
})
