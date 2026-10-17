import { convertQuestion, normalizeTolerance, type RawQuestion } from './questions'

function raw(over: Partial<RawQuestion>): RawQuestion {
  return {
    type: 'mcq',
    stem: ' Which index is higher? ',
    options: ['core', 'cladding', 'jacket', 'buffer'],
    correct_index: 0,
    correct_indices: null,
    tf_answer: null,
    model_answer: null,
    rubric: null,
    numeric_value: null,
    numeric_tolerance: null,
    numeric_unit: null,
    explanation: ' Because. ',
    option_rationales: ['a', 'b', 'c', 'd'],
    difficulty: 2,
    source_pages: [2],
    evidence: 'n1 is higher than n2',
    ...over
  }
}

describe('convertQuestion', () => {
  it('converts a valid mcq', () => {
    expect(convertQuestion(raw({}), null)).toEqual({
      type: 'mcq',
      stem: 'Which index is higher?',
      options: ['core', 'cladding', 'jacket', 'buffer'],
      answer: { type: 'mcq', correctIndex: 0 },
      explanation: 'Because.',
      optionRationales: ['a', 'b', 'c', 'd'],
      difficulty: 2,
      sourcePages: [2],
      evidence: 'n1 is higher than n2'
    })
  })

  it.each([
    ['missing correct_index', { correct_index: null }],
    ['correct_index out of range', { correct_index: 4 }],
    ['negative correct_index', { correct_index: -1 }],
    ['too few options', { options: ['a', 'b'] }],
    ['too many options', { options: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['empty option', { options: ['a', ' ', 'c'] }],
    ['duplicate options', { options: ['Core', 'core.', 'c'] }],
    ['no options', { options: null }],
    ['empty stem', { stem: '  ' }]
  ])('drops an mcq with %s', (_label, over) => {
    expect(convertQuestion(raw(over), null)).toBeNull()
  })

  it('drops rationales whose length does not match the options', () => {
    expect(convertQuestion(raw({ option_rationales: ['a', 'b'] }), null)?.optionRationales).toBeNull()
  })

  it('converts multi with unique sorted indices and rejects invalid ones', () => {
    expect(
      convertQuestion(raw({ type: 'multi', correct_index: null, correct_indices: [2, 0, 2] }), null)?.answer
    ).toEqual({
      type: 'multi',
      correctIndices: [0, 2]
    })
    expect(convertQuestion(raw({ type: 'multi', correct_indices: [] }), null)).toBeNull()
    expect(convertQuestion(raw({ type: 'multi', correct_indices: [1, 9] }), null)).toBeNull()
    expect(convertQuestion(raw({ type: 'multi', correct_indices: null }), null)).toBeNull()
  })

  it('converts tf and clears options', () => {
    const q = convertQuestion(raw({ type: 'tf', tf_answer: false }), null)
    expect(q).toMatchObject({ options: null, optionRationales: null, answer: { type: 'tf', value: false } })
    expect(convertQuestion(raw({ type: 'tf', tf_answer: null }), null)).toBeNull()
  })

  it('converts short answers and requires a model answer', () => {
    expect(
      convertQuestion(
        raw({ type: 'short', model_answer: ' Total internal reflection ', rubric: [' TIR ', '', 'TIR'] }),
        null
      )?.answer
    ).toEqual({ type: 'short', modelAnswer: 'Total internal reflection', rubric: ['TIR'] })
    expect(convertQuestion(raw({ type: 'short', model_answer: ' ' }), null)).toBeNull()
    expect(convertQuestion(raw({ type: 'short', model_answer: 'x', rubric: null }), null)?.answer).toEqual({
      type: 'short',
      modelAnswer: 'x',
      rubric: []
    })
  })

  it('converts numeric with tolerance and unit defaults', () => {
    expect(
      convertQuestion(raw({ type: 'numeric', numeric_value: 10, numeric_unit: ' dB ' }), null)?.answer
    ).toEqual({
      type: 'numeric',
      value: 10,
      tolerance: 0.02,
      unit: 'dB'
    })
    expect(convertQuestion(raw({ type: 'numeric', numeric_value: null }), null)).toBeNull()
    expect(
      convertQuestion(raw({ type: 'numeric', numeric_value: Number.POSITIVE_INFINITY }), null)
    ).toBeNull()
  })

  it('drops types that were not requested', () => {
    expect(convertQuestion(raw({}), ['tf', 'numeric'])).toBeNull()
    expect(convertQuestion(raw({}), ['mcq'])).not.toBeNull()
  })

  it('clamps difficulty to 1..5', () => {
    expect(convertQuestion(raw({ difficulty: 11 }), null)?.difficulty).toBe(5)
    expect(convertQuestion(raw({ difficulty: -2 }), null)?.difficulty).toBe(1)
  })
})

describe('normalizeTolerance', () => {
  it.each([
    [null, 0.02],
    [0.05, 0.05],
    [-0.01, 0.01],
    [2, 0.02],
    [80, 0.5],
    [0, 0]
  ])('%s -> %s', (input, expected) => {
    expect(normalizeTolerance(input)).toBeCloseTo(expected)
  })
})
