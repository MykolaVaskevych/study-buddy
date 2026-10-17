import { toFtsQuery } from './fts'

describe('toFtsQuery', () => {
  it.each([
    ['fiber', '"fiber"*'],
    ['fiber attenuation', '"fiber"* "attenuation"*'],
    ['TCP/IP', '"TCP IP"'],
    ['e-mail', '"e mail"*'],
    ['  spaced   out  ', '"spaced"* "out"*'],
    ['ab', '"ab"'],
    ['0.2 dB/km', '"0 2" "dB km"'],
    ['Dämpfung', '"Dämpfung"*'],
    ['wavelength-division multiplexing', '"wavelength division"* "multiplexing"*']
  ])('%j -> %s', (input, expected) => {
    expect(toFtsQuery(input)).toBe(expected)
  })

  it.each([
    ['AND', '"AND"*'],
    ['fiber OR copper', '"fiber"* "OR" "copper"*'],
    ['NOT x', '"NOT"* "x"'],
    ['NEAR(a b)', '"NEAR a"' + ' "b"'],
    ['text:fiber', '"text fiber"*'],
    ['"unbalanced', '"unbalanced"*'],
    ['^start', '"start"*'],
    ['wild*', '"wild"*']
  ])('neutralises FTS syntax in %j', (input, expected) => {
    expect(toFtsQuery(input)).toBe(expected)
  })

  it.each(['', '   ', '"""', '*', '()', '-- ;', '^'])('returns null for %j', (input) => {
    expect(toFtsQuery(input)).toBeNull()
  })

  it('caps the number of terms', () => {
    const query = toFtsQuery(Array.from({ length: 50 }, (_, i) => `term${i}`).join(' '))
    expect(query?.split(' ')).toHaveLength(12)
  })
})
