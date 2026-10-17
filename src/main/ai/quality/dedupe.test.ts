import { dedupeBy, jaccard, trigrams } from './dedupe'

describe('trigram similarity', () => {
  it('is 1 for texts that differ only in case and punctuation', () => {
    expect(jaccard(trigrams('What is the critical angle?'), trigrams('what is the CRITICAL angle'))).toBe(1)
  })

  it('is low for unrelated texts', () => {
    expect(
      jaccard(trigrams('Define chromatic dispersion.'), trigrams('Compute the power budget.'))
    ).toBeLessThan(0.3)
  })
})

describe('dedupeBy', () => {
  const key = (s: string): string => s

  it('drops items similar to existing texts', () => {
    expect(
      dedupeBy(['What is the critical angle?', 'How is OSNR defined?'], key, ['What is the critical angle'])
    ).toEqual(['How is OSNR defined?'])
  })

  it('keeps the first of near-duplicates within the batch', () => {
    expect(
      dedupeBy(
        [
          'What does the core refractive index n1 have to exceed?',
          'What does the core refractive index n1 have to exceed ?!',
          'Why does attenuation limit link length?'
        ],
        key,
        []
      )
    ).toEqual([
      'What does the core refractive index n1 have to exceed?',
      'Why does attenuation limit link length?'
    ])
  })

  it('keeps related but different questions', () => {
    const items = [
      'What is the attenuation of single-mode fibre at 1550 nm?',
      'What is the attenuation of multimode fibre at 850 nm?'
    ]
    expect(dedupeBy(items, key, [])).toEqual(items)
  })

  it('respects a custom threshold', () => {
    expect(dedupeBy(['abc def', 'abc deg'], key, [], 0.3)).toEqual(['abc def'])
  })
})
