import { bestWindowOverlap, groundItem, quoteMatches, validPages, verifyEvidence } from './grounding'
import { normalizeText } from './text'

const PAGE =
  'Total internal reflection. Light stays inside the fibre core because the core refractive index n1 is higher than the cla- dding index n2. Rays hitting the boundary above the critical angle are reflected.'

describe('normalizeText', () => {
  it('folds case, ligatures, diacritics, punctuation and line-end hyphenation', () => {
    expect(normalizeText('The ﬁbre’s  Cla- dding, Ä!')).toBe('the fibre s cladding a')
  })
})

describe('quoteMatches', () => {
  it('matches a verbatim quote regardless of case and punctuation', () => {
    expect(quoteMatches('light stays inside the fibre core', PAGE)).toBe(true)
  })

  it('matches across a hyphenated line break', () => {
    expect(quoteMatches('higher than the cladding index n2', PAGE)).toBe(true)
  })

  it('matches LaTeX-marked symbols against plain text (compact containment)', () => {
    expect(quoteMatches('the core refractive index $n_1$ is higher', PAGE)).toBe(true)
  })

  it('tolerates a small omission or change (>= 80 % of words in a window)', () => {
    expect(
      quoteMatches('Rays hitting the boundary above the critical angle are totally reflected', PAGE)
    ).toBe(true)
  })

  it('rejects a paraphrase', () => {
    expect(quoteMatches('Light is trapped since the cladding has a lower index than the core', PAGE)).toBe(
      false
    )
  })

  it('rejects scattered words that only occur far apart', () => {
    expect(quoteMatches('total core reflected angle boundary', PAGE)).toBe(false)
  })

  it('needs containment for very short quotes', () => {
    expect(quoteMatches('fibre core', PAGE)).toBe(true)
    expect(quoteMatches('core fibre', PAGE)).toBe(false)
  })

  it('never matches empty input', () => {
    expect(quoteMatches('', PAGE)).toBe(false)
    expect(quoteMatches('light', '')).toBe(false)
  })
})

describe('bestWindowOverlap', () => {
  it('counts repeated words only as often as the quote has them', () => {
    expect(bestWindowOverlap(['a', 'b', 'a'], ['a', 'a', 'a', 'b'])).toBe(3)
    expect(bestWindowOverlap(['a', 'b'], ['a', 'a', 'a', 'a'])).toBe(1)
  })
})

describe('validPages', () => {
  it('keeps integer pages inside the range, de-duplicated and sorted', () => {
    expect(validPages([7, 3, 3, 12, 0, 4.5, 5], 3, 10)).toEqual([3, 5, 7])
  })
})

describe('verifyEvidence', () => {
  const text = (p: number): string => ({ 2: PAGE, 4: 'P_rx = P_tx - alpha * L' })[p] ?? ''

  it('is verified when the quote is on a source page with text', () => {
    expect(verifyEvidence('light stays inside the fibre core', [2], text)).toBe('verified')
  })

  it('is verified when the quote is on any of several source pages', () => {
    expect(verifyEvidence('P_rx = P_tx - alpha * L', [2, 4], text)).toBe('verified')
  })

  it('is unverified when no text page contains the quote, or the quote is missing', () => {
    expect(verifyEvidence('dispersion compensating fibre', [2], text)).toBe('unverified')
    expect(verifyEvidence(null, [2], text)).toBe('unverified')
    expect(verifyEvidence('  ', [2], text)).toBe('unverified')
  })

  it('is not applicable when every source page is image-only', () => {
    expect(verifyEvidence('the diagram shows a fibre', [3], text)).toBe('not_applicable')
    expect(verifyEvidence(null, [3, 6], text)).toBe('not_applicable')
  })
})

describe('groundItem', () => {
  const text = (p: number): string => (p === 2 ? PAGE : '')

  it('drops out-of-range pages and verifies against the rest', () => {
    expect(
      groundItem(
        { sourcePages: [1, 2, 9], evidence: 'light stays inside the fibre core' },
        { from: 2, to: 5 },
        text
      )
    ).toEqual({
      sourcePages: [2],
      evidence: 'light stays inside the fibre core',
      verification: 'verified'
    })
  })

  it('returns null when no source page is inside the range', () => {
    expect(groundItem({ sourcePages: [1, 9], evidence: 'x' }, { from: 2, to: 5 }, text)).toBeNull()
    expect(groundItem({ sourcePages: [], evidence: 'x' }, { from: 2, to: 5 }, text)).toBeNull()
  })

  it('turns an empty quote into null evidence', () => {
    expect(groundItem({ sourcePages: [3], evidence: ' ' }, { from: 2, to: 5 }, text)).toEqual({
      sourcePages: [3],
      evidence: null,
      verification: 'not_applicable'
    })
  })
})
