import type { Concept, ExamSignal, Exercise, Formula, PageKind } from '@shared/domain'

/**
 * Course content for browser mode. Each book is a list of topics; each topic has a few slide
 * templates that repeat across its page range. Page notes, search text and the generated PDF
 * are all derived from this, so they agree with each other.
 */

export interface SlideSpec {
  title: string
  summary: string
  keyPoints: string[]
  concepts?: Concept[]
  formulas?: Formula[]
  exercises?: Exercise[]
  signals?: ExamSignal[]
  kind?: PageKind
}

export interface TopicSpec {
  title: string
  from: number
  to: number
  objectives: string[]
  difficulty: number
  examWeight: number
  coreFraction: number
  coreMinutes: number
  fullMinutes: number
  mastery: number | null
  slides: SlideSpec[]
  children?: TopicSpec[]
  /** Titles of topics in the same book that this one builds on (planner prerequisites). */
  prerequisites?: string[]
}

export interface BookSpec {
  id: string
  title: string
  pageCount: number
  importedDaysAgo: number
  openedDaysAgo: number | null
  lastPage: number
  examInDays: number | null
  /** Pages 1..indexedThrough are indexed at start. */
  indexedThrough: number
  topicsBuilt: boolean
  cardsDue: number
  language: string
  topics: TopicSpec[]
}

const c = (term: string, definition: string, importance: Concept['importance'] = 'core'): Concept => ({
  term,
  definition,
  importance
})

const f = (
  latex: string,
  meaning: string,
  symbols: [string, string, string | null][],
  importance: Formula['importance'] = 'core'
): Formula => ({
  latex,
  meaning,
  importance,
  symbols: symbols.map(([symbol, m, unit]) => ({ symbol, meaning: m, unit }))
})

const optical: TopicSpec[] = [
  {
    title: 'Why optical networks',
    from: 3,
    to: 12,
    objectives: ['Explain why fibre replaced copper for long-haul links'],
    difficulty: 1,
    examWeight: 0.04,
    coreFraction: 0.8,
    coreMinutes: 15,
    fullMinutes: 30,
    mastery: 0.82,
    slides: [
      {
        title: 'From copper to glass',
        summary:
          'Fibre carries terabits per second over thousands of kilometres because glass loses very little light at 1550 nm and the optical carrier offers enormous bandwidth.',
        keyPoints: [
          'Typical single-mode loss is **0.2 dB/km** at 1550 nm, against tens of dB/km for coax at GHz rates.',
          'Bandwidth is limited by dispersion and amplifiers, not by the medium itself.',
          'Fibre is immune to electromagnetic interference and hard to tap.'
        ],
        concepts: [
          c('Low-loss window', 'Wavelength band around 1550 nm where silica fibre attenuation is lowest.')
        ]
      },
      {
        title: 'Where optical links are used',
        summary: 'Optical links span data-centre interconnects, metro rings and submarine cables.',
        keyPoints: [
          'Short reach: multimode fibre and VCSELs inside data centres.',
          'Long haul: single-mode fibre with amplifiers every 80 to 100 km.'
        ]
      }
    ]
  },
  {
    title: 'Light in a fibre',
    from: 13,
    to: 30,
    objectives: ['Apply Snell’s law to find the critical angle', 'Compute the numerical aperture'],
    difficulty: 2,
    examWeight: 0.12,
    coreFraction: 0.7,
    coreMinutes: 45,
    fullMinutes: 105,
    mastery: 0.58,
    slides: [],
    children: [
      {
        title: 'Snell’s law and total internal reflection',
        from: 13,
        to: 21,
        objectives: ['Derive the critical angle'],
        difficulty: 2,
        examWeight: 0.07,
        coreFraction: 0.75,
        coreMinutes: 20,
        fullMinutes: 45,
        mastery: 0.66,
        slides: [
          {
            title: 'Total internal reflection',
            summary:
              'Light stays in the core because the core index $n_1$ is higher than the cladding index $n_2$; rays hitting the boundary beyond the critical angle are fully reflected.',
            keyPoints: [
              'Refraction at a boundary follows Snell’s law.',
              'Above the critical angle $\\theta_c$ no light is transmitted into the cladding.',
              'The index difference is tiny, typically $n_1 - n_2 \\approx 0.005$.'
            ],
            concepts: [
              c('Critical angle', 'Smallest angle of incidence at which total internal reflection occurs.'),
              c('Cladding', 'Lower-index glass around the core that confines light.', 'supporting')
            ],
            formulas: [
              f(
                'n_1 \\sin\\theta_1 = n_2 \\sin\\theta_2',
                'Snell’s law of refraction at the core–cladding boundary.',
                [
                  ['n_1, n_2', 'refractive indices of core and cladding', null],
                  ['\\theta_1, \\theta_2', 'angles to the normal', 'rad']
                ]
              ),
              f(
                '\\theta_c = \\arcsin\\left(\\frac{n_2}{n_1}\\right)',
                'Critical angle for total internal reflection.',
                [
                  ['\\theta_c', 'critical angle', 'rad'],
                  ['n_1, n_2', 'core and cladding indices', null]
                ]
              )
            ],
            signals: ['emphasis']
          },
          {
            title: 'Worked example: critical angle',
            summary: 'With $n_1 = 1.48$ and $n_2 = 1.46$ the critical angle is about 80.6°.',
            keyPoints: ['Plug the indices into the arcsine; keep four significant figures until the end.'],
            exercises: [
              {
                question: 'A fibre has $n_1 = 1.48$ and $n_2 = 1.46$. Find $\\theta_c$.',
                answer: '$\\theta_c = \\arcsin(1.46/1.48) \\approx 80.6°$'
              }
            ],
            signals: ['worked_example'],
            kind: 'exercise'
          }
        ]
      },
      {
        title: 'Modes and numerical aperture',
        from: 22,
        to: 30,
        objectives: ['Compute NA and the V-number', 'Decide whether a fibre is single-mode'],
        difficulty: 3,
        examWeight: 0.05,
        coreFraction: 0.6,
        coreMinutes: 25,
        fullMinutes: 60,
        mastery: 0.41,
        prerequisites: ['Snell’s law and total internal reflection'],
        slides: [
          {
            title: 'Numerical aperture',
            summary: 'The numerical aperture sets the acceptance cone of the fibre.',
            keyPoints: [
              'A larger NA collects more light but supports more modes.',
              'Single-mode operation requires $V < 2.405$.'
            ],
            concepts: [c('Numerical aperture', 'Sine of the maximum acceptance angle in air.')],
            formulas: [
              f('\\mathrm{NA} = \\sqrt{n_1^2 - n_2^2}', 'Numerical aperture of a step-index fibre.', [
                ['\\mathrm{NA}', 'numerical aperture', null],
                ['n_1, n_2', 'core and cladding indices', null]
              ]),
              f('V = \\frac{2\\pi a}{\\lambda}\\,\\mathrm{NA}', 'Normalised frequency (V-number).', [
                ['a', 'core radius', 'm'],
                ['\\lambda', 'wavelength', 'm']
              ])
            ],
            signals: ['exam_trap']
          }
        ]
      }
    ]
  },
  {
    title: 'Attenuation and the power budget',
    from: 31,
    to: 50,
    objectives: ['Convert between mW and dBm', 'Close a link power budget'],
    difficulty: 3,
    examWeight: 0.2,
    coreFraction: 0.75,
    coreMinutes: 60,
    fullMinutes: 150,
    mastery: 0.35,
    slides: [
      {
        title: 'Power budget',
        summary:
          'The received power is the launch power minus every loss along the link; the link works if it stays above the receiver sensitivity with margin.',
        keyPoints: [
          'Work in dB: losses add, gains subtract.',
          'Always keep a system margin of 3 to 6 dB for ageing and repairs.',
          'dBm is an absolute power, dB is a ratio. Never add two dBm values.'
        ],
        concepts: [
          c('Receiver sensitivity', 'Minimum received power for the target bit error rate.'),
          c('System margin', 'Extra loss budget kept in reserve for ageing and repairs.', 'supporting')
        ],
        formulas: [
          f(
            'P_{rx} = P_{tx} - \\alpha L - n_c L_c - M',
            'Received power after fibre, connector losses and margin.',
            [
              ['P_{rx}', 'received power', 'dBm'],
              ['P_{tx}', 'launch power', 'dBm'],
              ['\\alpha', 'fibre attenuation', 'dB/km'],
              ['L', 'link length', 'km'],
              ['n_c L_c', 'number of connectors × loss each', 'dB'],
              ['M', 'system margin', 'dB']
            ]
          ),
          f('P_{\\mathrm{dBm}} = 10\\log_{10}\\frac{P}{1\\,\\mathrm{mW}}', 'Absolute power in dBm.', [
            ['P', 'optical power', 'mW']
          ])
        ],
        signals: ['exam_trap', 'emphasis']
      },
      {
        title: 'Loss mechanisms',
        summary:
          'Absorption and Rayleigh scattering set the intrinsic loss floor; bends and splices add the rest.',
        keyPoints: [
          'Rayleigh scattering falls as $\\lambda^{-4}$, which favours longer wavelengths.',
          'Macro-bends leak light when the bend radius is too small.'
        ],
        concepts: [c('Rayleigh scattering', 'Scattering by sub-wavelength density fluctuations in glass.')]
      },
      {
        title: 'Try it: 80 km link',
        summary: 'Practice closing a budget with realistic numbers.',
        keyPoints: ['Write the budget as a table: source, each loss, margin, result.'],
        exercises: [
          {
            question:
              'Launch power 0 dBm, 80 km of 0.2 dB/km fibre, 4 connectors at 0.5 dB, margin 3 dB. What is $P_{rx}$?',
            answer: '$0 - 16 - 2 - 3 = -21$ dBm'
          }
        ],
        signals: ['quiz_slide'],
        kind: 'exercise'
      }
    ]
  },
  {
    title: 'Dispersion',
    from: 51,
    to: 68,
    objectives: ['Estimate pulse spreading', 'Find the dispersion-limited bit rate'],
    difficulty: 4,
    examWeight: 0.16,
    coreFraction: 0.6,
    coreMinutes: 75,
    fullMinutes: 180,
    mastery: null,
    prerequisites: ['Modes and numerical aperture'],
    slides: [
      {
        title: 'Chromatic dispersion',
        summary: 'Different wavelengths travel at different speeds, so pulses spread as they propagate.',
        keyPoints: [
          'Standard fibre has $D \\approx 17$ ps/(nm·km) at 1550 nm.',
          'Spreading grows with length and source linewidth.',
          'Pulses must not spread beyond about a quarter of the bit period.'
        ],
        concepts: [
          c('Dispersion parameter', 'Pulse spreading per unit linewidth and length, in ps/(nm·km).')
        ],
        formulas: [
          f('\\Delta\\tau = D\\,L\\,\\Delta\\lambda', 'Pulse broadening from chromatic dispersion.', [
            ['\\Delta\\tau', 'pulse broadening', 'ps'],
            ['D', 'dispersion parameter', 'ps/(nm·km)'],
            ['\\Delta\\lambda', 'source spectral width', 'nm']
          ]),
          f('B \\le \\frac{1}{4\\,\\Delta\\tau}', 'Dispersion-limited bit rate.', [
            ['B', 'bit rate', 'bit/s']
          ])
        ]
      },
      {
        title: 'Lecturer’s correction',
        summary: 'The slide in the printed notes uses ns where it should be ps; the formula itself is right.',
        keyPoints: ['Check units in the dispersion example: the answer is 340 ps, not 340 ns.'],
        signals: ['slide_correction']
      }
    ]
  },
  {
    title: 'Transmitters and receivers',
    from: 69,
    to: 88,
    objectives: ['Compute photodiode responsivity and photocurrent'],
    difficulty: 3,
    examWeight: 0.12,
    coreFraction: 0.7,
    coreMinutes: 45,
    fullMinutes: 120,
    mastery: null,
    prerequisites: ['Attenuation and the power budget'],
    slides: [
      {
        title: 'Photodetectors',
        summary: 'A photodiode turns optical power into current; responsivity says how many amps per watt.',
        keyPoints: ['PIN diodes are simple and linear; APDs add internal gain at the cost of excess noise.'],
        concepts: [c('Responsivity', 'Photocurrent per unit incident optical power, in A/W.')],
        formulas: [
          f('R = \\frac{\\eta q}{h\\nu}', 'Responsivity of a photodiode.', [
            ['R', 'responsivity', 'A/W'],
            ['\\eta', 'quantum efficiency', null],
            ['q', 'electron charge', 'C'],
            ['h\\nu', 'photon energy', 'J']
          ]),
          f('I_p = R\\,P_{in}', 'Photocurrent.', [
            ['I_p', 'photocurrent', 'A'],
            ['P_{in}', 'incident optical power', 'W']
          ])
        ]
      }
    ]
  },
  {
    title: 'Optical amplifiers and noise',
    from: 89,
    to: 106,
    objectives: ['Explain EDFA operation', 'Estimate OSNR over a chain of amplifiers'],
    difficulty: 4,
    examWeight: 0.14,
    coreFraction: 0.55,
    coreMinutes: 135,
    fullMinutes: 330,
    mastery: null,
    children: [
      {
        title: 'Erbium-doped fibre amplifiers',
        from: 89,
        to: 98,
        objectives: [
          'Explain how an EDFA amplifies the C-band',
          'Read gain and noise figure off a datasheet'
        ],
        difficulty: 3,
        examWeight: 0.08,
        coreFraction: 0.7,
        coreMinutes: 45,
        fullMinutes: 90,
        mastery: null,
        prerequisites: ['Attenuation and the power budget'],
        slides: []
      },
      {
        title: 'OSNR chain derivation',
        from: 99,
        to: 106,
        objectives: ['Derive OSNR after N amplified spans from ASE power spectral density'],
        difficulty: 5,
        examWeight: 0.06,
        coreFraction: 0.3,
        coreMinutes: 90,
        fullMinutes: 240,
        mastery: null,
        prerequisites: ['Erbium-doped fibre amplifiers'],
        slides: [
          {
            title: 'OSNR after a chain of amplifiers',
            summary:
              'Each span adds the same ASE noise, so noise power grows with N while signal power stays fixed; the derivation starts from the ASE spectral density of one amplifier.',
            keyPoints: [
              'ASE power in a reference bandwidth: $P_{ASE} = n_{sp}\\,h\\nu\\,(G-1)\\,B_{ref}$ per amplifier.',
              'With N identical spans the noise adds linearly, so OSNR falls by $10\\log_{10} N$ dB.',
              'The 58 dB constant comes from $h\\nu$ at 1550 nm and a 0.1 nm reference bandwidth.'
            ],
            concepts: [
              c(
                'Spontaneous emission factor',
                'Population inversion factor $n_{sp} \\geq 1$ of an amplifier.'
              )
            ],
            formulas: [
              f(
                'P_{ASE} = n_{sp}\\,h\\nu\\,(G-1)\\,B_{ref}',
                'ASE noise power of one amplifier in the reference bandwidth.',
                [
                  ['n_{sp}', 'spontaneous emission factor', null],
                  ['G', 'amplifier gain', null],
                  ['B_{ref}', 'reference optical bandwidth', 'Hz']
                ],
                'detail'
              )
            ]
          }
        ]
      }
    ],
    slides: [
      {
        title: 'Erbium-doped fibre amplifiers',
        summary: 'EDFAs amplify the whole C-band at once, which made dense WDM practical.',
        keyPoints: [
          'Pumped at 980 or 1480 nm.',
          'Each amplifier adds ASE noise; OSNR drops with every span.'
        ],
        concepts: [c('ASE', 'Amplified spontaneous emission: broadband noise added by optical amplifiers.')],
        formulas: [
          f(
            '\\mathrm{OSNR}_{\\mathrm{dB}} = 58 + P_{in} - NF - 10\\log_{10} N',
            'OSNR (0.1 nm bandwidth) after N identical spans.',
            [
              ['P_{in}', 'input power per channel', 'dBm'],
              ['NF', 'amplifier noise figure', 'dB'],
              ['N', 'number of spans', null]
            ]
          )
        ],
        signals: ['exam_trap']
      }
    ]
  },
  {
    title: 'Wavelength-division multiplexing',
    from: 107,
    to: 126,
    objectives: ['Convert channel spacing between nm and GHz'],
    difficulty: 3,
    examWeight: 0.12,
    coreFraction: 0.7,
    coreMinutes: 45,
    fullMinutes: 120,
    mastery: null,
    prerequisites: ['Erbium-doped fibre amplifiers', 'Dispersion'],
    slides: [
      {
        title: 'The ITU grid',
        summary: 'DWDM channels sit on a fixed frequency grid, typically 50 or 100 GHz apart.',
        keyPoints: ['At 1550 nm, 100 GHz spacing is about 0.8 nm.'],
        formulas: [
          f('\\Delta f = \\frac{c\\,\\Delta\\lambda}{\\lambda^2}', 'Channel spacing in frequency.', [
            ['\\Delta f', 'frequency spacing', 'Hz'],
            ['c', 'speed of light', 'm/s']
          ])
        ]
      }
    ]
  },
  {
    title: 'Network design and protection',
    from: 127,
    to: 140,
    objectives: ['Compare 1+1 and 1:1 protection'],
    difficulty: 2,
    examWeight: 0.06,
    coreFraction: 0.8,
    coreMinutes: 20,
    fullMinutes: 60,
    mastery: null,
    prerequisites: ['Wavelength-division multiplexing'],
    slides: [
      {
        title: 'Protection schemes',
        summary: '1+1 sends traffic on both paths; 1:1 keeps the backup idle until a failure.',
        keyPoints: ['Ring networks restore traffic in under 50 ms.'],
        concepts: [
          c('1+1 protection', 'Traffic is bridged onto both working and protection paths permanently.')
        ]
      }
    ]
  },
  {
    title: 'Practice exam',
    from: 141,
    to: 146,
    objectives: ['Rehearse exam-style questions under time pressure'],
    difficulty: 3,
    examWeight: 0.04,
    coreFraction: 1,
    coreMinutes: 30,
    fullMinutes: 30,
    mastery: null,
    slides: [
      {
        title: 'Practice exam question',
        summary: 'Past-paper style question combining the power budget with dispersion limits.',
        keyPoints: ['Expect one budget question and one dispersion question in the real exam.'],
        exercises: [
          {
            question:
              'A 10 Gb/s link uses a source with 0.1 nm linewidth over 60 km of standard fibre. Is it dispersion limited?',
            answer:
              '$\\Delta\\tau = 17 \\cdot 60 \\cdot 0.1 = 102$ ps, which exceeds $1/(4B) = 25$ ps, so yes.'
          }
        ],
        signals: ['practice_exam'],
        kind: 'exercise'
      }
    ]
  }
]

const signals: TopicSpec[] = [
  {
    title: 'Signals and their properties',
    from: 3,
    to: 60,
    objectives: ['Classify signals as energy or power signals'],
    difficulty: 2,
    examWeight: 0.25,
    coreFraction: 0.7,
    coreMinutes: 40,
    fullMinutes: 80,
    mastery: 0.74,
    slides: [
      {
        title: 'Energy and power signals',
        summary: 'Finite-energy signals have zero average power; periodic signals have infinite energy.',
        keyPoints: ['Energy: integrate $|x(t)|^2$ over all time.'],
        formulas: [
          f('E = \\int_{-\\infty}^{\\infty} |x(t)|^2\\,dt', 'Signal energy.', [['x(t)', 'signal', null]])
        ]
      }
    ]
  },
  {
    title: 'Convolution and LTI systems',
    from: 61,
    to: 130,
    objectives: ['Compute a convolution graphically'],
    difficulty: 4,
    examWeight: 0.4,
    coreFraction: 0.6,
    coreMinutes: 60,
    fullMinutes: 140,
    mastery: 0.61,
    prerequisites: ['Signals and their properties'],
    slides: [
      {
        title: 'Convolution',
        summary: 'The output of an LTI system is the input convolved with the impulse response.',
        keyPoints: ['Flip, shift, multiply, integrate.'],
        formulas: [
          f('y(t) = \\int_{-\\infty}^{\\infty} x(\\tau)\\,h(t-\\tau)\\,d\\tau', 'Convolution integral.', [
            ['h(t)', 'impulse response', null]
          ])
        ],
        signals: ['exam_trap']
      }
    ]
  },
  {
    title: 'Fourier transform and sampling',
    from: 131,
    to: 212,
    objectives: ['State the sampling theorem'],
    difficulty: 4,
    examWeight: 0.35,
    coreFraction: 0.65,
    coreMinutes: 55,
    fullMinutes: 120,
    mastery: 0.55,
    prerequisites: ['Convolution and LTI systems'],
    slides: [
      {
        title: 'Fourier transform',
        summary: 'The Fourier transform decomposes a signal into complex exponentials.',
        keyPoints: ['Time shift becomes a linear phase in frequency.'],
        formulas: [
          f('X(f) = \\int_{-\\infty}^{\\infty} x(t)\\,e^{-j2\\pi f t}\\,dt', 'Fourier transform.', [
            ['f', 'frequency', 'Hz']
          ]),
          f('f_s > 2 f_{\\max}', 'Nyquist sampling condition.', [['f_s', 'sampling rate', 'Hz']])
        ],
        signals: ['formula_sheet']
      }
    ]
  }
]

export const BOOKS: BookSpec[] = [
  {
    id: 'optical-networks',
    title: 'Optical Networks',
    pageCount: 146,
    importedDaysAgo: 12,
    openedDaysAgo: 0,
    lastPage: 37,
    examInDays: 9,
    indexedThrough: 60,
    topicsBuilt: true,
    cardsDue: 12,
    language: 'en',
    topics: optical
  },
  {
    id: 'signals-systems',
    title: 'Signals and Systems: Lecture Slides',
    pageCount: 212,
    importedDaysAgo: 30,
    openedDaysAgo: 2,
    lastPage: 118,
    examInDays: 3,
    indexedThrough: 212,
    topicsBuilt: true,
    cardsDue: 23,
    language: 'en',
    topics: signals
  },
  {
    id: 'probability-notes',
    title: 'Probability for Engineers, Lecture Notes',
    pageCount: 88,
    importedDaysAgo: 0,
    openedDaysAgo: null,
    lastPage: 1,
    examInDays: null,
    indexedThrough: 0,
    topicsBuilt: false,
    cardsDue: 0,
    language: 'en',
    topics: [
      {
        title: 'Random variables',
        from: 3,
        to: 88,
        objectives: [],
        difficulty: 3,
        examWeight: 1,
        coreFraction: 0.7,
        coreMinutes: 60,
        fullMinutes: 120,
        mastery: null,
        slides: [
          {
            title: 'Expectation',
            summary: 'The expectation is the probability-weighted average of a random variable.',
            keyPoints: ['Linearity holds even for dependent variables.'],
            formulas: [
              f('\\mathbb{E}[X] = \\sum_x x\\,p(x)', 'Expectation of a discrete variable.', [
                ['p(x)', 'pmf', null]
              ])
            ]
          }
        ]
      }
    ]
  }
]

/** Flattens topics depth-first (parents before children). */
export function flattenTopics(topics: TopicSpec[]): { spec: TopicSpec; parent: TopicSpec | null }[] {
  const out: { spec: TopicSpec; parent: TopicSpec | null }[] = []
  const visit = (list: TopicSpec[], parent: TopicSpec | null): void => {
    for (const spec of list) {
      out.push({ spec, parent })
      if (spec.children) visit(spec.children, spec)
    }
  }
  visit(topics, null)
  return out
}

/** The slide shown on a page: title page, contents, or the deepest topic's template. */
export function slideFor(book: BookSpec, page: number): SlideSpec & { topic: string | null } {
  if (page === 1) {
    return { title: book.title, summary: '', keyPoints: [], kind: 'title', topic: null }
  }
  if (page === 2) {
    return {
      title: 'Contents',
      summary: '',
      keyPoints: book.topics.map((t) => `${t.title} (p. ${t.from})`),
      kind: 'toc',
      topic: null
    }
  }
  let deepest: TopicSpec | null = null
  for (const { spec } of flattenTopics(book.topics)) {
    if (page >= spec.from && page <= spec.to && spec.slides.length > 0) deepest = spec
  }
  if (!deepest) return { title: '', summary: '', keyPoints: [], kind: 'blank', topic: null }
  const index = page - deepest.from
  const template = deepest.slides[index % deepest.slides.length] ?? deepest.slides[0]
  if (!template) return { title: '', summary: '', keyPoints: [], kind: 'blank', topic: null }
  const repeat = Math.floor(index / deepest.slides.length)
  return {
    ...template,
    title: repeat > 0 ? `${template.title} (${repeat + 1})` : template.title,
    topic: deepest.title
  }
}

/** Plain text of a page, used by the mock search. */
export function pageText(book: BookSpec, page: number): string {
  const s = slideFor(book, page)
  return [s.title, s.summary, ...s.keyPoints, ...(s.concepts ?? []).map((x) => `${x.term}: ${x.definition}`)]
    .join(' ')
    .replace(/[*$\\{}]/g, '')
}
