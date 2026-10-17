import type { IndexedPageOutput } from '@shared/ai/schemas'
import { INDEX_LIMITS, normalizeIndexedPages, normalizeLanguage, stripMathDelimiters } from './pages'

function page(n: number, over: Partial<IndexedPageOutput> = {}): IndexedPageOutput {
  return {
    page: n,
    kind: 'content',
    teachable: true,
    summary: `Summary ${n}`,
    key_points: [],
    concepts: [],
    formulas: [],
    exercises: [],
    exam_signals: [],
    ...over
  }
}

describe('normalizeIndexedPages', () => {
  it('drops pages outside the chunk and reports the missing ones', () => {
    const { pages, missingPages } = normalizeIndexedPages(
      [page(10), page(12), page(25), page(9), page(11.5)],
      10,
      14
    )
    expect(pages.map((p) => p.page)).toEqual([10, 12])
    expect(missingPages).toEqual([11, 13, 14])
  })

  it('keeps one entry per page, the richer one, sorted', () => {
    const { pages } = normalizeIndexedPages(
      [
        page(3, { summary: 'short' }),
        page(2),
        page(3, { summary: 'a much longer summary', key_points: ['k'] })
      ],
      1,
      3
    )
    expect(pages.map((p) => [p.page, p.summary])).toEqual([
      [2, 'Summary 2'],
      [3, 'a much longer summary']
    ])
  })

  it('forces teachable=false for title, toc, blank and references pages', () => {
    const kinds = ['title', 'toc', 'blank', 'references', 'content', 'exercise'] as const
    const { pages } = normalizeIndexedPages(
      kinds.map((kind, i) => page(i + 1, { kind, teachable: true })),
      1,
      kinds.length
    )
    expect(pages.map((p) => p.teachable)).toEqual([false, false, false, false, true, true])
  })

  it('clamps arrays, cleans strings and strips math delimiters', () => {
    const many = Array.from({ length: 30 }, (_, i) => `point ${i}`)
    const { pages } = normalizeIndexedPages(
      [
        page(1, {
          summary: 'x'.repeat(5000),
          key_points: ['  dup ', 'dup', '', ...many],
          concepts: [
            { term: ' Core ', definition: ' d ', importance: 'core' },
            { term: 'core', definition: 'again', importance: 'detail' },
            { term: '', definition: 'no term', importance: 'detail' }
          ],
          formulas: [
            {
              latex: '$P = U I$',
              meaning: ' power ',
              symbols: [{ symbol: 'U', meaning: 'voltage', unit: ' ' }],
              importance: 'core'
            },
            { latex: '  ', meaning: 'empty', symbols: [], importance: 'detail' }
          ],
          exercises: [{ question: 'Q?', answer: '' }],
          exam_signals: ['emphasis', 'emphasis', 'quiz_slide']
        })
      ],
      1,
      1
    )
    const p = pages[0]!
    expect(p.summary.length).toBe(INDEX_LIMITS.summaryChars)
    expect(p.keyPoints).toHaveLength(INDEX_LIMITS.keyPoints)
    expect(p.keyPoints[0]).toBe('dup')
    expect(p.concepts).toEqual([{ term: 'Core', definition: 'd', importance: 'core' }])
    expect(p.formulas).toEqual([
      {
        latex: 'P = U I',
        meaning: 'power',
        symbols: [{ symbol: 'U', meaning: 'voltage', unit: null }],
        importance: 'core'
      }
    ])
    expect(p.exercises).toEqual([{ question: 'Q?', answer: null }])
    expect(p.examSignals).toEqual(['emphasis', 'quiz_slide'])
  })
})

describe('stripMathDelimiters', () => {
  it.each([
    ['$x^2$', 'x^2'],
    ['$$\\frac{a}{b}$$', '\\frac{a}{b}'],
    ['\\(a+b\\)', 'a+b'],
    ['\\[a+b\\]', 'a+b'],
    [' E = mc^2 ', 'E = mc^2'],
    ['a $b$ c', 'a $b$ c']
  ])('%s -> %s', (input, expected) => {
    expect(stripMathDelimiters(input)).toBe(expected)
  })
})

describe('normalizeLanguage', () => {
  it.each([
    ['en', 'en'],
    ['EN', 'en'],
    ['de-AT', 'de'],
    ['uk_UA', 'uk'],
    ['english', 'und'],
    ['', 'und']
  ])('%s -> %s', (input, expected) => {
    expect(normalizeLanguage(input)).toBe(expected)
  })
})
