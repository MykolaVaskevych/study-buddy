import { clozePlain, hasCloze, parseCloze } from './cloze'

describe('parseCloze', () => {
  it('splits text and gaps', () => {
    expect(parseCloze('Loss is {{c1::0.2 dB/km}} at {{c2::1550 nm}}.')).toEqual([
      { kind: 'text', text: 'Loss is ' },
      { kind: 'gap', n: 1, answer: '0.2 dB/km', hint: null },
      { kind: 'text', text: ' at ' },
      { kind: 'gap', n: 2, answer: '1550 nm', hint: null },
      { kind: 'text', text: '.' }
    ])
  })

  it('keeps LaTeX braces inside the answer', () => {
    expect(parseCloze('falls as {{c1::$\\lambda^{-4}$}}, so')).toEqual([
      { kind: 'text', text: 'falls as ' },
      { kind: 'gap', n: 1, answer: '$\\lambda^{-4}$', hint: null },
      { kind: 'text', text: ', so' }
    ])
    expect(parseCloze('{{c1::$\\frac{a}{b}$}}')[0]).toMatchObject({ answer: '$\\frac{a}{b}$' })
  })

  it('reads hints', () => {
    expect(parseCloze('{{c1::3 to 6 dB::a range in dB}}')[0]).toEqual({
      kind: 'gap',
      n: 1,
      answer: '3 to 6 dB',
      hint: 'a range in dB'
    })
  })

  it('leaves malformed markers as text', () => {
    expect(parseCloze('{{c1::never closed')).toEqual([{ kind: 'text', text: '{{c1::never closed' }])
    expect(parseCloze('{{cx::no number}}')).toEqual([{ kind: 'text', text: '{{cx::no number}}' }])
    expect(hasCloze('plain text')).toBe(false)
  })

  it('renders plain previews', () => {
    const text = 'Margin of {{c1::3 to 6 dB::a range}} and {{c2::ageing}}.'
    expect(clozePlain(text, false)).toBe('Margin of [a range] and […].')
    expect(clozePlain(text, true)).toBe('Margin of 3 to 6 dB and ageing.')
  })
})
