import {
  chooseTitle,
  cleanTitle,
  countNonSpace,
  fileStem,
  firstMeaningfulLine,
  hasTextLayer,
  joinTextRuns,
  normaliseText,
  type TextRun
} from './text'

const run = (str: string, x: number, y: number, extra: Partial<TextRun> = {}): TextRun => ({
  str,
  hasEOL: false,
  x,
  y,
  width: str.length * 5,
  height: 10,
  horizontal: true,
  ...extra
})

describe('joinTextRuns', () => {
  it('breaks lines on hasEOL and ignores empty EOL items', () => {
    const runs = [
      run('Hello', 0, 100, { hasEOL: true }),
      run('', 0, 0, { hasEOL: true }),
      run('World', 0, 80)
    ]
    expect(joinTextRuns(runs)).toBe('Hello\nWorld')
  })

  it('adds a newline when the baseline jumps without EOL and a space for positioned gaps', () => {
    expect(joinTextRuns([run('Networks', 0, 100), run('W2', 300, 20)])).toBe('Networks\nW2')
    expect(joinTextRuns([run('core', 0, 100), run('index', 30, 100)])).toBe('core index')
  })

  it('does not split words that pdf.js emitted as adjacent runs', () => {
    expect(joinTextRuns([run('Wire', 0, 100), run('less', 20, 100)])).toBe('Wireless')
    expect(joinTextRuns([run('a ', 0, 100), run('b', 50, 100)])).toBe('a b')
  })

  it('trusts pdf.js for rotated text', () => {
    expect(
      joinTextRuns([run('ab', 0, 0, { horizontal: false }), run('cd', 0, 300, { horizontal: false })])
    ).toBe('abcd')
  })
})

describe('normaliseText', () => {
  it('collapses spaces, drops blank lines and control or zero-width characters', () => {
    expect(normaliseText('  a\t\tb \r\n\n\n c\u0000d\u200Be\u00ADf  ')).toBe('a b\nc def')
  })
})

describe('text layer detection', () => {
  it('needs about 40 non-space characters', () => {
    expect(countNonSpace(' a b\nc ')).toBe(3)
    expect(hasTextLayer('12')).toBe(false)
    expect(hasTextLayer('x'.repeat(39))).toBe(false)
    expect(hasTextLayer('x'.repeat(40))).toBe(true)
  })
})

describe('titles', () => {
  it('rejects placeholders, file names, paths, numbers and overly long text', () => {
    for (const bad of [
      '',
      '   ',
      'Untitled',
      'Presentation1',
      'PowerPoint Presentation',
      'slides.pptx',
      '/tmp/x',
      '42',
      'x'.repeat(201)
    ]) {
      expect(cleanTitle(bad)).toBeNull()
    }
    expect(cleanTitle(undefined)).toBeNull()
  })

  it('cleans app prefixes and whitespace', () => {
    expect(cleanTitle('Microsoft PowerPoint - Optical   Links')).toBe('Optical Links')
    expect(cleanTitle('Microsoft Word - notes.docx')).toBeNull()
  })

  it('prefers metadata, then the first meaningful line of page 1, then the file name', () => {
    const base = { firstPageText: '1\nFibre Optics 101\nmore', fileName: 'lecture.pdf' }
    expect(chooseTitle({ ...base, metadata: [null, 'Real Title'] })).toBe('Real Title')
    expect(chooseTitle({ ...base, metadata: ['Untitled'] })).toBe('Fibre Optics 101')
    expect(firstMeaningfulLine('7\n8')).toBeNull()
    expect(chooseTitle({ metadata: [], firstPageText: '1', fileName: 'dir/wireless.pdf' })).toBe('wireless')
  })

  it('takes the file stem without directory or extension', () => {
    expect(fileStem('C:\\x\\notes.v2.pdf')).toBe('notes.v2')
    expect(fileStem('README')).toBe('README')
  })
})
