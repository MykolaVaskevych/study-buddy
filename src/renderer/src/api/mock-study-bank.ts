import type { Card, CardType, Question, QuestionAnswer } from '@shared/domain'

/**
 * Hand-written study content for browser mode: questions per slide template (all five types,
 * with option rationales and [p. N] citations) and seed flashcards per book (basic, cloze,
 * formula, contrast). Keyed by slide/topic titles from ./mock-data.
 */

export type QuestionSeed = Pick<Question, 'type' | 'stem' | 'options' | 'answer' | 'explanation'> & {
  optionRationales: string[] | null
  /** Mock-only: keyword groups a short answer must hit, one group per rubric point. */
  keywords?: string[][]
}

const mcq = (
  stem: string,
  options: string[],
  correctIndex: number,
  explanation: string,
  rationales: string[] | null = null
): QuestionSeed => ({
  type: 'mcq',
  stem,
  options,
  answer: { type: 'mcq', correctIndex },
  explanation,
  optionRationales: rationales
})

const multi = (
  stem: string,
  options: string[],
  correctIndices: number[],
  explanation: string,
  rationales: string[] | null = null
): QuestionSeed => ({
  type: 'multi',
  stem,
  options,
  answer: { type: 'multi', correctIndices },
  explanation,
  optionRationales: rationales
})

const tf = (stem: string, value: boolean, explanation: string): QuestionSeed => ({
  type: 'tf',
  stem,
  options: null,
  answer: { type: 'tf', value },
  explanation,
  optionRationales: null
})

const num = (
  stem: string,
  value: number,
  unit: string | null,
  tolerance: number,
  explanation: string
): QuestionSeed => ({
  type: 'numeric',
  stem,
  options: null,
  answer: { type: 'numeric', value, unit, tolerance },
  explanation,
  optionRationales: null
})

const short = (
  stem: string,
  modelAnswer: string,
  rubric: string[],
  keywords: string[][],
  explanation: string
): QuestionSeed => ({
  type: 'short',
  stem,
  options: null,
  answer: { type: 'short', modelAnswer, rubric } satisfies QuestionAnswer,
  explanation,
  optionRationales: null,
  keywords
})

/** Questions per slide template title. The page is the one being tested (for citations). */
export const QUESTION_BANK: Record<string, (p: number) => QuestionSeed[]> = {
  'Power budget': (p) => [
    mcq(
      'Why is it wrong to add two dBm values?',
      [
        'dBm is an absolute power level, so the sum of two levels has no physical meaning',
        'dBm values are always negative, so the sum is meaningless',
        'dBm uses a base-2 logarithm, which does not add',
        'Only connector losses may be added in a budget'
      ],
      0,
      `A budget starts from one level, the launch power in dBm, and subtracts losses and margins in dB [p. ${p}].`,
      [
        'dBm is referenced to 1 mW. You add *ratios* in dB to a level in dBm, never two levels.',
        'dBm can be positive: 0 dBm is 1 mW and many lasers launch +3 dBm.',
        'dBm uses $10\\log_{10}$, the same base-10 logarithm as dB.',
        'Every loss in dB adds up in a budget: fibre, connectors, splices and margin.'
      ]
    ),
    num(
      'Launch power is 2 dBm. The link has 60 km of fibre at 0.25 dB/km and you keep a 3 dB system margin; ignore connectors. What is the received power $P_{rx}$?',
      -16,
      'dBm',
      0.01,
      `$P_{rx} = 2 - 0.25 \\cdot 60 - 3 = -16$ dBm. The fibre alone loses $\\alpha L = 15$ dB [p. ${p}].`
    ),
    tf(
      'A system margin of 3 to 6 dB is kept in reserve for ageing and repairs.',
      true,
      `The slide recommends keeping 3 to 6 dB of margin [p. ${p}].`
    ),
    multi(
      'Which of these are subtracted from the launch power in a link budget? Pick all that apply.',
      ['Fibre attenuation × length', 'Connector losses', 'System margin', 'Receiver sensitivity'],
      [0, 1, 2],
      `Losses and the margin come off the launch power; the result is then compared with the receiver sensitivity [p. ${p}].`,
      [
        'Yes: $\\alpha L$ in dB.',
        'Yes: each connector adds its loss, typically 0.5 dB.',
        'Yes: the margin is reserved, so it is subtracted too.',
        'No: sensitivity is the threshold you compare $P_{rx}$ against, not a loss.'
      ]
    ),
    short(
      'Explain the difference between dB and dBm.',
      'dB expresses a ratio between two powers, such as a gain or a loss. dBm is an absolute power level relative to 1 mW, so 0 dBm is 1 mW and 10 dBm is 10 mW.',
      ['dB is a ratio between two powers', 'dBm is an absolute level relative to 1 mW', '0 dBm equals 1 mW'],
      [
        ['ratio', 'relative between'],
        ['absolute', 'milliwatt', '1 mw', '1mw'],
        ['0 dbm', '0dbm']
      ],
      `See the warning about dBm on [p. ${p}].`
    )
  ],
  'Loss mechanisms': (p) => [
    mcq(
      'Why does Rayleigh scattering favour longer wavelengths?',
      [
        'It does not depend on wavelength',
        'It grows as $\\lambda^{2}$',
        'It falls as $\\lambda^{-4}$',
        'Absorption cancels it above 1300 nm'
      ],
      2,
      `Rayleigh scattering falls steeply with wavelength, as $\\lambda^{-4}$ [p. ${p}].`,
      [
        'It depends strongly on wavelength; that is why 1550 nm is used.',
        'The dependence is inverse, not proportional.',
        'Right: doubling the wavelength cuts scattering by a factor of 16.',
        'Absorption adds loss; it never cancels scattering.'
      ]
    ),
    short(
      'Name the two mechanisms that set the intrinsic loss floor of silica fibre.',
      'Material absorption and Rayleigh scattering.',
      ['Absorption', 'Rayleigh scattering'],
      [['absorp'], ['rayleigh', 'scatter']],
      `Absorption and Rayleigh scattering are intrinsic; bends and splices add the rest [p. ${p}].`
    ),
    tf(
      'Bending a fibre more tightly reduces its loss.',
      false,
      `Macro-bends leak light when the bend radius is too small, so tight bends add loss [p. ${p}].`
    )
  ],
  'Try it: 80 km link': (p) => [
    num(
      'Launch power 0 dBm, 80 km of 0.2 dB/km fibre, 4 connectors at 0.5 dB each, 3 dB margin. What is $P_{rx}$?',
      -21,
      'dBm',
      0.01,
      `$0 - 16 - 2 - 3 = -21$ dBm [p. ${p}].`
    ),
    mcq(
      'The receiver sensitivity is −24 dBm and $P_{rx} = -21$ dBm. How much spare power does the link have?',
      ['−3 dB', '3 dB', '45 dB', '3 dBm'],
      1,
      `Spare power is the difference of two levels: $-21 - (-24) = 3$ dB [p. ${p}].`,
      [
        'The spare power is positive because $P_{rx}$ is above the sensitivity.',
        'Right: the difference of two levels is a ratio, in dB.',
        'You added the two levels instead of subtracting them.',
        'A difference between two dBm levels is a ratio, so its unit is dB, not dBm.'
      ]
    ),
    tf(
      'In a budget table, losses in dB are added together before they are subtracted from the launch power.',
      true,
      `Losses in dB add; write them as a table and subtract the total [p. ${p}].`
    )
  ],
  'Total internal reflection': (p) => [
    mcq(
      'What is the critical angle for total internal reflection?',
      [
        '$\\theta_c = \\arcsin(n_1/n_2)$',
        '$\\theta_c = \\arccos(n_2/n_1)$',
        '$\\theta_c = \\arctan(n_1 - n_2)$',
        '$\\theta_c = \\arcsin(n_2/n_1)$'
      ],
      3,
      `Set the refraction angle to 90° in Snell’s law: $n_1 \\sin\\theta_c = n_2$ [p. ${p}].`,
      [
        '$n_1/n_2 > 1$, so its arcsine is undefined.',
        'The critical angle comes from a sine, not a cosine.',
        'There is no arctangent in Snell’s law.',
        'Right: from $n_1 \\sin\\theta_c = n_2 \\sin 90°$.'
      ]
    ),
    num(
      'A fibre has $n_1 = 1.48$ and $n_2 = 1.46$. Find the critical angle $\\theta_c$ in degrees.',
      80.6,
      null,
      0.005,
      `$\\theta_c = \\arcsin(1.46/1.48) \\approx 80.6°$ [p. ${p}].`
    ),
    tf(
      'Total internal reflection needs a cladding index higher than the core index.',
      false,
      `It is the other way round: the core index $n_1$ must be higher than $n_2$ [p. ${p}].`
    )
  ],
  'Numerical aperture': (p) => [
    multi(
      'Which statements about the numerical aperture are true? Pick all that apply.',
      [
        'A larger NA collects more light',
        'A larger NA supports more modes',
        'NA depends only on the core radius',
        '$\\mathrm{NA} = \\sqrt{n_1^2 - n_2^2}$'
      ],
      [0, 1, 3],
      `NA sets the acceptance cone and depends on the two indices, not on the radius [p. ${p}].`,
      [
        'Yes: a wider acceptance cone.',
        'Yes: which is why single-mode fibre has a small NA.',
        'No: the radius enters the V-number, not the NA.',
        'Yes: this is the step-index formula.'
      ]
    ),
    num(
      'Compute the numerical aperture for $n_1 = 1.48$ and $n_2 = 1.46$.',
      0.2425,
      null,
      0.02,
      `$\\sqrt{1.48^2 - 1.46^2} = \\sqrt{0.0588} \\approx 0.243$ [p. ${p}].`
    ),
    tf(
      'A fibre is single-mode when $V < 2.405$.',
      true,
      `Single-mode operation requires $V < 2.405$ [p. ${p}].`
    )
  ],
  'Chromatic dispersion': (p) => [
    num(
      'A source with 0.1 nm linewidth drives 60 km of fibre with $D = 17$ ps/(nm·km). What is the pulse broadening $\\Delta\\tau$?',
      102,
      'ps',
      0.02,
      `$\\Delta\\tau = D L \\Delta\\lambda = 17 \\cdot 60 \\cdot 0.1 = 102$ ps [p. ${p}].`
    ),
    mcq(
      'Which change reduces chromatic pulse spreading?',
      ['A longer link', 'A narrower source linewidth', 'A higher bit rate', 'More launch power'],
      1,
      `Spreading grows with length and linewidth: $\\Delta\\tau = D L \\Delta\\lambda$ [p. ${p}].`,
      [
        'Longer links spread pulses more.',
        'Right: a smaller $\\Delta\\lambda$ means less spreading.',
        'The bit rate does not change the spreading; it changes how much you can tolerate.',
        'Power does not affect linear dispersion.'
      ]
    ),
    tf(
      'Pulses may spread up to a full bit period before errors appear.',
      false,
      `Keep spreading below about a quarter of the bit period [p. ${p}].`
    )
  ],
  'Erbium-doped fibre amplifiers': (p) => [
    mcq(
      'At which wavelengths are EDFAs pumped?',
      ['850 nm', '1310 nm', '980 or 1480 nm', '1550 nm only'],
      2,
      `EDFAs are pumped at 980 or 1480 nm [p. ${p}].`
    ),
    num(
      'Input power per channel is 0 dBm, the amplifier noise figure is 5 dB, and there are 10 identical spans. What is the OSNR (0.1 nm bandwidth)?',
      43,
      'dB',
      0.01,
      `$58 + 0 - 5 - 10\\log_{10} 10 = 43$ dB [p. ${p}].`
    ),
    tf('Each amplifier in a chain adds ASE noise.', true, `OSNR drops with every span [p. ${p}].`)
  ],
  'The ITU grid': (p) => [
    num(
      'DWDM channels at 1550 nm are 0.8 nm apart. What is the spacing in frequency?',
      100,
      'GHz',
      0.03,
      `$\\Delta f = c\\,\\Delta\\lambda/\\lambda^2 \\approx 100$ GHz [p. ${p}].`
    ),
    tf(
      'DWDM channels sit on a fixed frequency grid.',
      true,
      `The ITU grid fixes the channel frequencies [p. ${p}].`
    ),
    mcq(
      'Which spacing is typical for DWDM?',
      ['50 or 100 GHz', '1 THz', '10 MHz', '20 nm'],
      0,
      `Typical spacings are 50 or 100 GHz [p. ${p}].`
    )
  ],
  'Energy and power signals': (p) => [
    mcq(
      'A periodic signal of finite amplitude is…',
      ['an energy signal', 'a power signal', 'neither', 'both'],
      1,
      `Periodic signals have infinite energy but finite average power [p. ${p}].`
    ),
    tf(
      'A finite-energy signal has zero average power.',
      true,
      `Energy signals have zero average power [p. ${p}].`
    ),
    short(
      'How do you decide whether a signal is an energy signal?',
      'Integrate $|x(t)|^2$ over all time. If the result is finite, it is an energy signal.',
      ['Integrate the squared magnitude over all time', 'The result must be finite'],
      [['integra', 'squar'], ['finite']],
      `Energy is the integral of $|x(t)|^2$ [p. ${p}].`
    )
  ],
  Convolution: (p) => [
    mcq(
      'What is the output of an LTI system?',
      [
        'The input multiplied by the impulse response',
        'The input convolved with the impulse response',
        'The impulse response delayed by the input',
        'The derivative of the input'
      ],
      1,
      `$y(t) = x(t) * h(t)$ [p. ${p}].`
    ),
    short(
      'List the steps of graphical convolution.',
      'Flip the impulse response, shift it by $t$, multiply it with the input and integrate the product.',
      ['Flip', 'Shift', 'Multiply', 'Integrate'],
      [
        ['flip', 'mirror', 'revers'],
        ['shift', 'slide'],
        ['multipl', 'product'],
        ['integra', 'area']
      ],
      `Flip, shift, multiply, integrate [p. ${p}].`
    ),
    tf('Convolution is commutative.', true, `$x * h = h * x$ [p. ${p}].`)
  ],
  'Fourier transform': (p) => [
    num(
      'A signal is band-limited to $f_{\\max} = 4$ kHz. What is the minimum sampling rate to avoid aliasing?',
      8,
      'kHz',
      0.01,
      `$f_s > 2 f_{\\max} = 8$ kHz [p. ${p}].`
    ),
    mcq(
      'A time shift of a signal changes its spectrum by…',
      ['a linear phase', 'a frequency shift', 'a scaling of the magnitude', 'nothing'],
      0,
      `A shift by $t_0$ multiplies $X(f)$ by $e^{-j2\\pi f t_0}$ [p. ${p}].`
    ),
    tf(
      'The Fourier transform of a real signal has a symmetric magnitude spectrum.',
      true,
      `$|X(-f)| = |X(f)|$ [p. ${p}].`
    )
  ]
}

export interface CardSeed {
  topic: string
  type: CardType
  front: string
  back: string
  page: number
  essential: boolean
  /** Days from now; negative = overdue. */
  dueInDays: number
}

const card = (
  topic: string,
  type: CardType,
  page: number,
  front: string,
  back: string,
  dueInDays: number,
  essential = true
): CardSeed => ({ topic, type, page, front, back, dueInDays, essential })

/** Seed decks per book id: a mix of due and upcoming cards of every type. */
export const CARD_BANK: Record<string, CardSeed[]> = {
  'optical-networks': [
    card(
      'Attenuation and the power budget',
      'contrast',
      31,
      'dB versus dBm: what is the difference?',
      '**dB** is a ratio between two powers.\n\n**dBm** is an absolute power relative to 1 mW: $0\\,\\mathrm{dBm} = 1\\,\\mathrm{mW}$. Never add two dBm values.',
      -1
    ),
    card(
      'Why optical networks',
      'cloze',
      3,
      'Typical single-mode fibre loss is about {{c1::0.2 dB/km}} at {{c2::1550 nm}}.',
      'This low-loss window is why long-haul links run at 1550 nm.',
      -2
    ),
    card(
      'Attenuation and the power budget',
      'formula',
      31,
      'Write the received power of a link budget.',
      '$$P_{rx} = P_{tx} - \\alpha L - n_c L_c - M$$\n\nLaunch power minus fibre loss, connector losses and the system margin.',
      -1
    ),
    card(
      'Snell’s law and total internal reflection',
      'formula',
      13,
      'Critical angle for total internal reflection',
      '$$\\theta_c = \\arcsin\\left(\\frac{n_2}{n_1}\\right)$$\n\nNeeds $n_1 > n_2$.',
      -0.5
    ),
    card(
      'Attenuation and the power budget',
      'cloze',
      32,
      'Rayleigh scattering falls as {{c1::$\\lambda^{-4}$}}, which favours {{c2::longer::shorter or longer?}} wavelengths.',
      'The intrinsic loss floor together with absorption.',
      -0.2
    ),
    card(
      'Snell’s law and total internal reflection',
      'cloze',
      13,
      'Light stays in the core because the core index $n_1$ is {{c1::higher}} than the cladding index $n_2$.',
      'Typical index difference: $n_1 - n_2 \\approx 0.005$.',
      -3,
      false
    ),
    card(
      'Modes and numerical aperture',
      'formula',
      22,
      'Numerical aperture of a step-index fibre',
      '$$\\mathrm{NA} = \\sqrt{n_1^2 - n_2^2}$$',
      -1
    ),
    card(
      'Attenuation and the power budget',
      'cloze',
      31,
      'Keep a system margin of {{c1::3 to 6 dB::a range in dB}} for ageing and repairs.',
      'Margin is subtracted like a loss.',
      -0.1
    ),
    card(
      'Dispersion',
      'formula',
      51,
      'Pulse broadening from chromatic dispersion',
      '$$\\Delta\\tau = D\\,L\\,\\Delta\\lambda$$\n\n$D \\approx 17$ ps/(nm·km) for standard fibre at 1550 nm.',
      -1
    ),
    card(
      'Modes and numerical aperture',
      'cloze',
      22,
      'A fibre is single-mode when {{c1::$V < 2.405$}}.',
      '$V = \\frac{2\\pi a}{\\lambda}\\,\\mathrm{NA}$',
      2
    ),
    card(
      'Dispersion',
      'basic',
      51,
      'What limits the bit rate of a dispersion-limited link?',
      'Pulses must not spread beyond about a quarter of the bit period: $B \\le 1/(4\\Delta\\tau)$.',
      3,
      false
    ),
    card(
      'Optical amplifiers and noise',
      'basic',
      89,
      'Why did EDFAs make dense WDM practical?',
      'They amplify the whole C-band at once, so one amplifier serves every channel.',
      5
    )
  ],
  'signals-systems': [
    card(
      'Signals and their properties',
      'formula',
      3,
      'Energy of a signal',
      '$$E = \\int_{-\\infty}^{\\infty} |x(t)|^2\\,dt$$',
      -1
    ),
    card(
      'Signals and their properties',
      'cloze',
      3,
      'Finite-energy signals have {{c1::zero}} average power.',
      'Periodic signals are the opposite: infinite energy, finite power.',
      -2
    ),
    card(
      'Convolution and LTI systems',
      'formula',
      61,
      'Convolution integral',
      '$$y(t) = \\int_{-\\infty}^{\\infty} x(\\tau)\\,h(t-\\tau)\\,d\\tau$$',
      -1
    ),
    card(
      'Convolution and LTI systems',
      'basic',
      61,
      'How do you compute a convolution graphically?',
      'Flip $h$, shift it by $t$, multiply with $x$ and integrate the product.',
      -0.5
    ),
    card(
      'Fourier transform and sampling',
      'cloze',
      131,
      'To sample without aliasing, $f_s$ must exceed {{c1::$2 f_{\\max}$}}.',
      'The Nyquist rate.',
      -1
    ),
    card(
      'Fourier transform and sampling',
      'contrast',
      131,
      'Time shift versus its effect on the spectrum',
      'A shift by $t_0$ multiplies the spectrum by $e^{-j2\\pi f t_0}$: magnitude unchanged, linear phase.',
      4
    )
  ],
  'probability-notes': [
    card(
      'Random variables',
      'cloze',
      3,
      'Linearity of expectation holds {{c1::even for dependent}} variables.',
      '$\\mathbb{E}[X + Y] = \\mathbb{E}[X] + \\mathbb{E}[Y]$',
      6
    )
  ]
}

/** Builds a Card from a seed. */
export function cardFromSeed(
  docId: string,
  seed: CardSeed,
  index: number,
  now: Date,
  topicsBuilt: boolean
): Card {
  const day = 86_400_000
  // Calendar days, not 24-hour blocks: across a daylight-saving change those land on another day.
  const dueAt = new Date(now)
  dueAt.setDate(dueAt.getDate() + Math.trunc(seed.dueInDays))
  dueAt.setTime(dueAt.getTime() + (seed.dueInDays % 1) * day)
  const due = dueAt.toISOString()
  const fresh = index % 5 === 1
  return {
    id: `${docId}-card-${index + 1}`,
    docId,
    topicId: topicsBuilt ? `${docId}:${seed.topic}` : null,
    type: seed.type,
    front: seed.front,
    back: seed.back,
    essential: seed.essential,
    sourcePages: [seed.page],
    evidence: null,
    verification: index % 7 === 3 ? 'unverified' : 'verified',
    status: 'active',
    srs: {
      due,
      stability: fresh ? 0 : 4 + (index % 4),
      difficulty: 5,
      reps: fresh ? 0 : 2 + (index % 3),
      lapses: index % 6 === 0 ? 1 : 0,
      state: fresh ? 'new' : 'review',
      lastReview: fresh ? null : new Date(now.getTime() - 3 * day).toISOString(),
      elapsedDays: 3,
      scheduledDays: 3,
      learningSteps: 0
    },
    createdAt: new Date(now.getTime() - 6 * day).toISOString()
  }
}
