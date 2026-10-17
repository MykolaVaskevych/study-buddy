import type { Question, QuestionAnswer, QuestionResponse } from '../domain'
import { formatAnswer, gradeObjective } from './index'
import { parseUnit } from './units'

function question(answer: QuestionAnswer, overrides: Partial<Question> = {}): Question {
  return {
    id: 'q1',
    docId: 'd1',
    topicId: null,
    type: answer.type,
    stem: 'Stem',
    options:
      answer.type === 'mcq' || answer.type === 'multi' ? ['850 nm', '1310 nm', '1550 nm', '1625 nm'] : null,
    answer,
    explanation: 'Because physics.',
    optionRationales: null,
    difficulty: 2,
    sourcePages: [1],
    evidence: null,
    verification: 'verified',
    status: 'active',
    fromBook: false,
    createdAt: '2026-10-17T10:00:00.000Z',
    ...overrides
  }
}

const numeric = (value: number, unit: string | null, tolerance = 0.02): QuestionAnswer => ({
  type: 'numeric',
  value,
  unit,
  tolerance
})

describe('gradeObjective: numeric', () => {
  // [expected value, expected unit, tolerance, answered value, answered unit, correct, feedback pattern]
  it.each<[number, string | null, number, number, string | null, boolean, RegExp | null]>([
    // plain values and tolerance
    [10, 'dB', 0.02, 10, 'dB', true, null],
    [10, 'dB', 0.02, 10.15, 'dB', true, null],
    [10, 'dB', 0.02, 10.5, 'dB', false, null],
    [10, 'dB', 0, 10, 'dB', true, null],
    [3, 'dB', 0.02, 3, 'db', true, /= 3 dB/],
    // dB vs dBm are different quantities
    [30, 'dB', 0.02, 30, 'dBm', false, /dBm is an absolute power level.*ratio/],
    [30, 'dBm', 0.02, 30, 'dB', false, /dB is a ratio.*absolute power level in dBm/],
    // 1 mW == 0 dBm physically, but the units are not auto-converted: converting would accept a linear
    // answer to a question that tests the logarithmic conversion itself. The feedback explains it.
    [0, 'dBm', 0.02, 1, 'mW', false, /logarithmic power level in dBm.*linear/],
    [1, 'mW', 0.02, 0, 'dBm', false, /linear power in mW.*logarithmic/],
    // SI prefixes
    [2.5, 'Gb/s', 0.02, 2500, 'Mb/s', true, /2500 Mb\/s = 2\.5 Gb\/s/],
    [2.5, 'Gb/s', 0, 2500, 'Mb/s', true, null],
    [2.5, 'Gbit/s', 0.01, 2500, 'Mbps', true, null],
    [2.5, 'Gbps', 0.01, 2.5e9, 'b/s', true, null],
    [2.5, 'Gb/s', 0.02, 2.5, 'GHz', false, /different quantity/],
    [100, 'Mbit/s', 0.02, 12.5, 'MB/s', false, /factor of 8/],
    [193.1, 'THz', 0.001, 193100, 'GHz', true, null],
    [1, 'kHz', 0.01, 1000, 'hz', true, null],
    [5, 'ms', 0.02, 5000, 'µs', true, null],
    [5, 'ms', 0.02, 5, 'Ms', false, /factor of 10\^9.*prefix/],
    [2, 'mW', 0.02, 2, 'MW', false, /factor of 10\^9.*prefix/],
    [20, 'W', 0.02, 20000, 'mW', true, null],
    [20, 'W', 0.02, 20, 'w', true, /= 20 W/],
    [1550, 'nm', 0.01, 1.55, 'µm', true, null], // micro sign
    [1550, 'nm', 0.01, 1.55, 'μm', true, null], // Greek mu
    [1550, 'nm', 0.01, 1.55, 'um', true, null],
    [0.5, 'ns', 0.02, 500, 'ps', true, null],
    // attenuation and dispersion
    [0.2, 'dB/km', 0.05, 0.2, 'dB/km', true, null],
    [0.2, 'dB/km', 0.05, 0.0002, 'dB/m', true, null],
    [0.2, 'dB/km', 0.05, 0.2, 'dB', false, /different quantity/],
    [0.2, 'dB/km', 0.05, 0.2, 'dBm/km', false, /absolute power level/],
    [17, 'ps/(nm·km)', 0.05, 17, 'ps/nm/km', true, null],
    [17, 'ps/nm/km', 0.05, 17, 'ps/(nm km)', true, null],
    [17, 'ps/nm/km', 0.05, 0.017, 'ps/(nm·m)', true, null],
    [17, 'ps/(nm*km)', 0.05, 17, 'ps/nm·km', true, null],
    // missing unit: accepted when the number matches in the question's unit
    [1550, 'nm', 0.01, 1550, null, true, /include the unit \(nm\)/],
    [1550, 'nm', 0.01, 1.55, null, false, /Include the unit/],
    [1550, 'nm', 0.01, 1550, '  ', true, /include the unit/],
    // unitless answers
    [0.5, null, 0.02, 0.5, null, true, null],
    [0.5, null, 0.02, 0.5, 'dB', true, /No unit was expected/],
    // value 0: absolute tolerance fallback
    [0, null, 0.01, 0.005, null, true, null],
    [0, null, 0.01, 0.02, null, false, null],
    [0, 'dB', 0, 0, 'dB', true, null],
    // unknown units: exact string comparison of the unit
    [42, 'furlongs', 0.02, 42, 'furlongs', true, null],
    [42, 'furlongs', 0.02, 42, 'miles', false, /asks for the answer in furlongs, not miles/],
    [50, 'Ω', 0.02, 50, ' Ω ', true, null],
    [50, 'Ω', 0.02, 50, 'ohm', false, /in Ω, not ohm/],
    [3, 'ms', 0.02, 3, 'min', false, /in ms, not min/],
    // negative values
    [-3, 'dB', 0.02, -3.05, 'dB', true, null],
    [-3, 'dB', 0.02, 3, 'dB', false, null],
    // garbage
    [1, 'W', 0.02, Number.NaN, 'W', false, /not a number/],
    [1, 'W', 0.02, Number.POSITIVE_INFINITY, 'W', false, /not a number/]
  ])('%s %s (±%s) vs %s %s -> %s', (value, unit, tolerance, given, givenUnit, correct, feedback) => {
    const q = question(numeric(value, unit, tolerance))
    const res = gradeObjective(q, { type: 'numeric', value: given, unit: givenUnit })
    expect(res).not.toBeNull()
    expect(res!.correct).toBe(correct)
    expect(res!.score).toBe(correct ? 1 : 0)
    expect(res!.correctAnswer).toBe(formatAnswer(q))
    if (feedback) expect(res!.feedback).toMatch(feedback)
  })
})

describe('gradeObjective: mcq / tf / multi / short', () => {
  it('mcq is an exact index match and returns the chosen option rationale', () => {
    const q = question(
      { type: 'mcq', correctIndex: 2 },
      { optionRationales: ['Too lossy', 'Zero dispersion, not min loss', 'Minimum loss', 'L band'] }
    )
    expect(gradeObjective(q, { type: 'mcq', index: 2 })).toEqual({
      questionId: 'q1',
      correct: true,
      score: 1,
      feedback: 'Minimum loss',
      missingPoints: [],
      correctAnswer: '**C** — 1550 nm'
    })
    expect(gradeObjective(q, { type: 'mcq', index: 1 })).toMatchObject({
      correct: false,
      score: 0,
      feedback: 'Zero dispersion, not min loss'
    })
  })

  it.each<[boolean, boolean, boolean]>([
    [true, true, true],
    [true, false, false],
    [false, false, true],
    [false, true, false]
  ])('tf: key %s, answered %s -> %s', (key, given, correct) => {
    const res = gradeObjective(question({ type: 'tf', value: key }), { type: 'tf', value: given })
    expect(res).toMatchObject({ correct, score: correct ? 1 : 0, correctAnswer: key ? 'True' : 'False' })
  })

  // key = {0, 2, 3}: score = max(0, (right - wrong) / 3)
  it.each<[number[], number, boolean, string[]]>([
    [[0, 2, 3], 1, true, []],
    [[3, 0, 2, 2], 1, true, []],
    [[0, 2], 2 / 3, false, ['1625 nm']],
    [[0, 2, 3, 1], 2 / 3, false, []],
    [[0, 1], 0, false, ['1550 nm', '1625 nm']],
    [[1], 0, false, ['850 nm', '1550 nm', '1625 nm']],
    [[], 0, false, ['850 nm', '1550 nm', '1625 nm']]
  ])('multi: picks %j -> score %s', (indices, score, correct, missing) => {
    const res = gradeObjective(question({ type: 'multi', correctIndices: [0, 2, 3] }), {
      type: 'multi',
      indices
    })
    expect(res!.score).toBeCloseTo(score, 10)
    expect(res!.correct).toBe(correct)
    expect(res!.missingPoints).toEqual(missing)
  })

  it('multi feedback counts right and wrong picks', () => {
    const res = gradeObjective(question({ type: 'multi', correctIndices: [0, 2] }), {
      type: 'multi',
      indices: [0, 1]
    })
    expect(res!.feedback).toBe('You picked 1 of 2 correct options and 1 wrong one.')
  })

  it('multi with an empty key gives credit only for an empty selection', () => {
    const q = question({ type: 'multi', correctIndices: [] })
    expect(gradeObjective(q, { type: 'multi', indices: [] })).toMatchObject({ correct: true, score: 1 })
    expect(gradeObjective(q, { type: 'multi', indices: [1] })).toMatchObject({ correct: false, score: 0 })
  })

  it('short answers are left to the AI', () => {
    const q = question({ type: 'short', modelAnswer: 'Attenuation and dispersion', rubric: ['attenuation'] })
    expect(gradeObjective(q, { type: 'short', text: 'loss' })).toBeNull()
  })

  it.each<[QuestionAnswer, QuestionResponse]>([
    [
      { type: 'mcq', correctIndex: 0 },
      { type: 'tf', value: true }
    ],
    [
      { type: 'tf', value: true },
      { type: 'mcq', index: 0 }
    ],
    [
      { type: 'multi', correctIndices: [0] },
      { type: 'mcq', index: 0 }
    ],
    [numeric(1, 'W'), { type: 'short', text: '1 W' }]
  ])('a response of the wrong type scores 0 (%j)', (answer, response) => {
    expect(gradeObjective(question(answer), response)).toMatchObject({ correct: false, score: 0 })
  })
})

describe('formatAnswer', () => {
  it.each<[QuestionAnswer, string]>([
    [{ type: 'mcq', correctIndex: 1 }, '**B** — 1310 nm'],
    [{ type: 'multi', correctIndices: [3, 0] }, '- **A** — 850 nm\n- **D** — 1625 nm'],
    [{ type: 'tf', value: true }, 'True'],
    [{ type: 'tf', value: false }, 'False'],
    [
      { type: 'short', modelAnswer: 'Attenuation *and* dispersion', rubric: [] },
      'Attenuation *and* dispersion'
    ],
    [numeric(10, 'dB'), '10 dB (±2 %)'],
    [numeric(0.2, 'dB/km', 0.005), '0.2 dB/km (±0.5 %)'],
    [numeric(0.1 + 0.2, null), '0.3 (±2 %)'],
    [numeric(2500, 'Mb/s', 0), '2500 Mb/s']
  ])('%j -> %s', (answer, expected) => {
    expect(formatAnswer(question(answer))).toBe(expected)
  })

  it('mcq without options shows the letter only', () => {
    expect(formatAnswer(question({ type: 'mcq', correctIndex: 2 }, { options: null }))).toBe('**C**')
  })
})

describe('parseUnit', () => {
  it.each<[string, number, string]>([
    ['Hz', 1, 'Hz^1'],
    ['GHz', 1e9, 'Hz^1'],
    ['Mb/s', 1e6, 'bit^1,s^-1'],
    ['kbps', 1e3, 'bit^1,s^-1'],
    ['MB/s', 1e6, 'B^1,s^-1'],
    ['dB/km', 1e-3, 'dB^1,m^-1'],
    ['ps/(nm·km)', 1e-6, 'm^-2,s^1'],
    ['dBm', 1, 'dBm^1'],
    ['1/s', 1, 's^-1'],
    ['W/m²', 1, 'W^1,m^-2'],
    ['km^2', 1e6, 'm^2']
  ])('%s', (unit, factor, key) => {
    const parsed = parseUnit(unit)
    expect(parsed?.key).toBe(key)
    expect(parsed?.factor).toBeCloseTo(factor, 15)
  })

  it.each(['', 'furlongs', 'mdB', 'W/', 'm/m', 'm2', 'K'])('rejects %j', (unit) => {
    expect(parseUnit(unit)).toBeNull()
  })
})
