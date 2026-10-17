import { solvePlan } from './solver'
import { levelOptions } from './model'
import { updateBelief } from './belief'
import { planInput, topic } from './test-utils'
import type { PlanResult, PlanTopic } from './types'

const item = (plan: PlanResult, id: string) => {
  const it = plan.items.find((x) => x.topicId === id)
  if (!it) throw new Error(`no item ${id}`)
  return it
}

/** The headline triage case: weights sum to 1, written exam (no guessing), 2 h of learning. */
const headline: PlanTopic[] = [
  topic('A', {
    title: 'Nonlinear effects',
    examWeight: 0.04,
    coreFraction: 0.3,
    coreMinutes: 150,
    fullMinutes: 240
  }),
  topic('B', {
    title: 'OSNR budget',
    examWeight: 0.15,
    coreFraction: 0.7,
    coreMinutes: 30,
    fullMinutes: 120
  }),
  topic('C', {
    title: 'Chromatic dispersion',
    examWeight: 0.25,
    coreFraction: 0.6,
    coreMinutes: 30,
    fullMinutes: 60
  }),
  topic('D', {
    title: 'Everything else',
    examWeight: 0.56,
    coreFraction: 0.5,
    coreMinutes: 600,
    fullMinutes: 900
  })
]

describe('solvePlan: headline scenario', () => {
  const plan = solvePlan(headline, planInput({ targetScore: 0.3 }), {
    budgetMinutes: 120,
    reserveFraction: 0
  })

  it('skips the long hard topic, takes the core of the core-heavy one and all of the cheap valuable one', () => {
    expect(plan.items.map((i) => i.level)).toEqual(['skip', 'core', 'full', 'skip'])
    expect(item(plan, 'B').minutes).toBe(30)
    expect(item(plan, 'C').minutes).toBe(60)
    expect(plan.plannedMinutes).toBe(90)
    expect(plan.budgetMinutes).toBe(120)
  })

  it('expected score matches the hand computation', () => {
    // B core: 0.15 × 0.7 × 0.85 = 0.08925; C full: 0.25 × 0.90 = 0.225.
    expect(plan.expectedScore).toBeCloseTo(0.08925 + 0.225, 10)
    expect(plan.feasible).toBe(true)
  })

  it('explains every decision in one specific line', () => {
    expect(item(plan, 'A').reason).toBe('Skipped: ~4 h for ~4 % of marks')
    expect(item(plan, 'B').reason).toBe(
      "Core only: essentials give ~70 % of this topic's marks in 30 m; full needs 1 h 30 m more"
    )
    expect(item(plan, 'C').reason).toBe('Full: high value (~25 % of marks), 1 h')
    expect(plan.notes).toContain('Expected ~31 %, at or above your 30 % target.')
  })

  it('adds the guess rate for skipped material on multiple-choice exams', () => {
    const mcq = solvePlan(headline, planInput({ format: 'mcq' }), { budgetMinutes: 120, reserveFraction: 0 })
    // Same levels; skip earns w × 0.25 and core earns w × (cf × 0.85 + (1 − cf) × 0.25).
    expect(mcq.items.map((i) => i.level)).toEqual(['skip', 'core', 'full', 'skip'])
    const expected = 0.04 * 0.25 + 0.15 * (0.7 * 0.85 + 0.3 * 0.25) + 0.25 * 0.9 + 0.56 * 0.25
    expect(mcq.expectedScore).toBeCloseTo(expected, 10)
  })
})

describe('solvePlan: modes and feasibility', () => {
  it('min_time finds the smallest budget whose best plan reaches the target', () => {
    const target = 0.3
    const plan = solvePlan(headline, planInput({ mode: 'min_time', targetScore: target }), {
      budgetMinutes: 600,
      reserveFraction: 0
    })
    let minimal = -1
    for (let m = 0; m <= 600 && minimal < 0; m += 15) {
      const p = solvePlan(headline, planInput({ targetScore: target }), {
        budgetMinutes: m,
        reserveFraction: 0
      })
      if (p.expectedScore >= target) minimal = m
    }
    expect(minimal).toBe(90)
    expect(plan.plannedMinutes).toBe(minimal)
    expect(plan.feasible).toBe(true)
    expect(plan.notes).toContain(
      'Target 30 % reached with 1 h 30 m of learning; 8 h 30 m of learning time to spare.'
    )
  })

  it('reports an unreachable target with the best score and the time it would need', () => {
    const plan = solvePlan(headline, planInput({ targetScore: 0.8 }), { budgetMinutes: 360 })
    expect(plan.feasible).toBe(false)
    const note = plan.notes.find((n) => n.startsWith('Target 80 %'))
    expect(note).toMatch(/^Target 80 % not reachable in 6 h; best is ~\d+ %\. About .+ would get there\.$/)
    const minTime = solvePlan(headline, planInput({ targetScore: 0.8, mode: 'min_time' }), {
      budgetMinutes: 360
    })
    expect(minTime.feasible).toBe(false)
    expect(minTime.expectedScore).toBeCloseTo(plan.expectedScore, 10)
  })

  it('says when even full study of everything cannot reach the target', () => {
    const plan = solvePlan(headline, planInput({ targetScore: 0.95 }), { budgetMinutes: 60 })
    expect(plan.notes.at(-1)).toMatch(/Even studying everything in full gives ~90 %\.$/)
  })

  it('a zero budget skips everything, with reasons that say why', () => {
    const plan = solvePlan(headline, planInput(), { budgetMinutes: 0 })
    expect(plan.items.every((i) => i.level === 'skip' && i.minutes === 0)).toBe(true)
    expect(plan.expectedScore).toBe(0)
    expect(item(plan, 'C').reason).toBe(
      'Skipped: no study time in the budget (essentials take 30 m for ~15 % of marks)'
    )
  })

  it('handles no topics', () => {
    const plan = solvePlan([], planInput(), { budgetMinutes: 60 })
    expect(plan.items).toEqual([])
    expect(plan.feasible).toBe(false)
    expect(plan.notes).toContain('No topics yet; build the topic map first.')
  })

  it('is deterministic', () => {
    const input = planInput({ mode: 'min_time', targetScore: 0.25 })
    expect(solvePlan(headline, input, { budgetMinutes: 300 })).toEqual(
      solvePlan(headline, input, { budgetMinutes: 300 })
    )
  })
})

describe('solvePlan: budget and reserve', () => {
  it('derives the budget from hours per day until the exam and keeps 20 % in reserve', () => {
    const plan = solvePlan(headline, planInput({ examDate: '2026-10-20', hoursPerDay: 2 }), {
      today: '2026-10-17'
    })
    expect(plan.budgetMinutes + plan.reserveMinutes).toBe(360)
    expect(plan.reserveMinutes).toBe(72)
    expect(plan.notes[0]).toBe('Budget: 3 days × 2 h/day = 6 h until the exam.')
    expect(plan.notes[1]).toBe(
      'Kept 1 h 12 m (20 %) for page checks, spaced review and mock exams; 4 h 48 m for learning.'
    )
  })

  it('falls back to a default budget with a note', () => {
    const plan = solvePlan(headline, planInput())
    expect(plan.budgetMinutes + plan.reserveMinutes).toBe(600)
    expect(plan.notes[0]).toBe('No study time given; assumed 10 h. Set total hours or hours per day.')
  })
})

describe('solvePlan: overrides', () => {
  it('a pinned level always wins and its cost comes first', () => {
    const input = planInput({
      overrides: [
        { topicId: 'A', level: 'full' },
        { topicId: 'C', level: 'skip' }
      ]
    })
    const plan = solvePlan(headline, input, { budgetMinutes: 300, reserveFraction: 0 })
    expect(item(plan, 'A')).toMatchObject({ level: 'full', minutes: 240, forcedBy: 'user' })
    expect(item(plan, 'A').reason).toBe('You set this (4 h for ~4 % of marks)')
    expect(item(plan, 'C')).toMatchObject({ level: 'skip', forcedBy: 'user', reason: 'You set this' })
    // 60 m left after A: B core (30 m) is the best use.
    expect(item(plan, 'B').level).toBe('core')
    expect(plan.plannedMinutes).toBe(270)
  })

  it('pins beyond the budget are kept, flagged and make the plan infeasible', () => {
    const input = planInput({ targetScore: 0, overrides: [{ topicId: 'D', level: 'core' }] })
    const plan = solvePlan(headline, input, { budgetMinutes: 120, reserveFraction: 0 })
    expect(item(plan, 'D').level).toBe('core')
    expect(plan.plannedMinutes).toBe(600)
    expect(plan.feasible).toBe(false)
    expect(plan.notes).toContain(
      'Your pinned topics and their prerequisites need 10 h, more than the 2 h available for learning.'
    )
  })

  it('an exam-weight override replaces the estimate before normalising', () => {
    const topics = [topic('x', { examWeight: 0.5 }), topic('y', { examWeight: 0.5 })]
    const input = planInput({ overrides: [{ topicId: 'x', examWeight: 1.5 }] })
    const plan = solvePlan(topics, input, { budgetMinutes: 1000, reserveFraction: 0 })
    expect(item(plan, 'x').expectedMarks).toBeCloseTo(0.75 * 0.9, 10)
    expect(item(plan, 'y').expectedMarks).toBeCloseTo(0.25 * 0.9, 10)
    expect(plan.notes).toContain('Exam weights added up to 200 %; rescaled to 100 %.')
  })

  it('normalises weights so they total 1, and treats all-zero weights as equal', () => {
    const topics = [
      topic('x', { examWeight: 2 }),
      topic('y', { examWeight: 1 }),
      topic('z', { examWeight: 1 })
    ]
    const plan = solvePlan(topics, planInput(), { budgetMinutes: 10_000, reserveFraction: 0 })
    expect(plan.expectedScore).toBeCloseTo(0.9, 10)
    expect(item(plan, 'x').expectedMarks).toBeCloseTo(0.45, 10)
    const zero = solvePlan([topic('x', { examWeight: 0 }), topic('y', { examWeight: 0 })], planInput(), {
      budgetMinutes: 10_000
    })
    expect(item(zero, 'x').expectedMarks).toBeCloseTo(0.45, 10)
    expect(zero.notes).toContain('No exam weights known; all topics count the same.')
  })
})

describe('solvePlan: prerequisites', () => {
  const base = [
    topic('basics', { title: 'Fiber loss', examWeight: 0.01, coreMinutes: 30, fullMinutes: 60 }),
    topic('osnr', {
      title: 'OSNR budget',
      examWeight: 0.5,
      coreMinutes: 30,
      fullMinutes: 60,
      prerequisites: ['basics']
    }),
    topic('other', { title: 'Other', examWeight: 0.49, coreMinutes: 500, fullMinutes: 900 })
  ]

  it('forces a skipped prerequisite of a studied topic to at least core', () => {
    // 75 m: OSNR full alone would break the rule, so it drops to core to make room for its basics.
    const plan = solvePlan(base, planInput(), { budgetMinutes: 75, reserveFraction: 0 })
    expect(item(plan, 'osnr').level).toBe('core')
    expect(item(plan, 'basics')).toMatchObject({
      level: 'core',
      forcedBy: 'prerequisite',
      reason: "Required by 'OSNR budget' (prerequisite)"
    })
  })

  it('drops the dependent instead when its prerequisite costs more than it is worth', () => {
    const topics = [
      topic('heavy', { title: 'Heavy basics', examWeight: 0.01, coreMinutes: 240, fullMinutes: 300 }),
      topic('dep', { examWeight: 0.1, coreMinutes: 30, fullMinutes: 60, prerequisites: ['heavy'] }),
      topic('cheap', { examWeight: 0.3, coreMinutes: 60, fullMinutes: 120 }),
      topic('rest', { examWeight: 0.59, coreMinutes: 900, fullMinutes: 1000 })
    ]
    // "Force heavy and re-solve" would end at heavy core + cheap core (~13 %).
    // The exact search keeps cheap in full and skips the pair (27 %).
    const plan = solvePlan(topics, planInput(), { budgetMinutes: 300, reserveFraction: 0 })
    expect(plan.items.map((i) => i.level)).toEqual(['skip', 'skip', 'full', 'skip'])
    expect(plan.expectedScore).toBeCloseTo(0.27, 10)
    const roomy = solvePlan(topics, planInput(), { budgetMinutes: 420, reserveFraction: 0 })
    expect(roomy.items.map((i) => i.level)).toEqual(['core', 'full', 'full', 'skip'])
    expect(item(roomy, 'heavy')).toMatchObject({
      forcedBy: 'prerequisite',
      reason: "Required by 'dep' (prerequisite)"
    })
  })

  it('a valuable prerequisite keeps its own reason and notes who needs it', () => {
    const topics = [
      topic('base', { examWeight: 0.5, coreMinutes: 30, fullMinutes: 60 }),
      topic('dep', { examWeight: 0.5, coreMinutes: 30, fullMinutes: 60, prerequisites: ['base'] })
    ]
    const plan = solvePlan(topics, planInput(), { budgetMinutes: 120, reserveFraction: 0 })
    expect(item(plan, 'base')).toMatchObject({ level: 'full', forcedBy: null })
    expect(item(plan, 'base').reason).toBe("Full: high value (~50 % of marks), 1 h; needed for 'dep'")
  })

  it('a prerequisite the user skipped is not forced, but the plan says so', () => {
    const input = planInput({ overrides: [{ topicId: 'basics', level: 'skip' }] })
    const plan = solvePlan(base, input, { budgetMinutes: 90, reserveFraction: 0 })
    expect(item(plan, 'basics').level).toBe('skip')
    expect(item(plan, 'osnr').level).toBe('full')
    expect(plan.notes).toContain("'OSNR budget' builds on 'Fiber loss', which you chose to skip.")
  })

  it('pinning a dependent pulls in its prerequisite chain', () => {
    const chain = [
      topic('a', { examWeight: 0.01, coreMinutes: 15, fullMinutes: 30 }),
      topic('b', { examWeight: 0.01, coreMinutes: 15, fullMinutes: 30, prerequisites: ['a'] }),
      topic('c', { examWeight: 0.98, coreMinutes: 30, fullMinutes: 60, prerequisites: ['b'] })
    ]
    const plan = solvePlan(chain, planInput({ overrides: [{ topicId: 'c', level: 'core' }] }), {
      budgetMinutes: 0
    })
    expect(plan.items.map((i) => [i.level, i.forcedBy])).toEqual([
      ['core', 'prerequisite'],
      ['core', 'prerequisite'],
      ['core', 'user']
    ])
  })

  it('survives prerequisite cycles', () => {
    const cyc = [
      topic('p', { examWeight: 0.5, coreMinutes: 30, fullMinutes: 60, prerequisites: ['q'] }),
      topic('q', { examWeight: 0.5, coreMinutes: 30, fullMinutes: 60, prerequisites: ['p'] })
    ]
    const plan = solvePlan(cyc, planInput(), { budgetMinutes: 30, reserveFraction: 0 })
    expect(plan.items.map((i) => i.level)).toEqual(['skip', 'skip'])
    const roomy = solvePlan(cyc, planInput(), { budgetMinutes: 60, reserveFraction: 0 })
    expect(roomy.items.map((i) => i.level)).toEqual(['core', 'core'])
  })
})

describe('solvePlan: mastery', () => {
  it('time already spent lowers the remaining cost', () => {
    const t = topic('t', { coreMinutes: 60, fullMinutes: 120, minutesSpent: 50 })
    const opts = levelOptions(t, 1, 'written')
    expect(opts.core.minutes).toBe(15)
    expect(opts.full.minutes).toBe(75)
    const plan = solvePlan([topic('t', { minutesSpent: 120 })], planInput(), { budgetMinutes: 0 })
    expect(item(plan, 't')).toMatchObject({ level: 'full', minutes: 0, reason: 'Already studied in full' })
  })

  it('quiz evidence raises the value and can mark a topic as mastered', () => {
    let belief = null
    belief = updateBelief(belief, 40, 1)
    const known = topic('k', { examWeight: 0.5, minutesSpent: 120, mastery: belief })
    const plan = solvePlan([known, topic('u', { examWeight: 0.5 })], planInput(), { budgetMinutes: 0 })
    expect(item(plan, 'k').expectedMarks).toBeGreaterThan(0.5 * 0.9)
    expect(item(plan, 'k').reason).toBe('Already mastered (quizzes ~98 %)')

    // Unstudied but already known: skipping is worth a lot, so the time goes elsewhere.
    const quizzed = topic('q', { examWeight: 0.5, coreMinutes: 60, fullMinutes: 120, mastery: belief })
    const other = topic('o', { examWeight: 0.5, coreMinutes: 60, fullMinutes: 120 })
    const p2 = solvePlan([quizzed, other], planInput(), { budgetMinutes: 120, reserveFraction: 0 })
    expect(item(p2, 'q').level).toBe('skip')
    expect(item(p2, 'q').reason).toBe('Already mastered (quizzes ~98 %)')
    expect(item(p2, 'o').level).toBe('full')
  })

  it('weak evidence moves the value only a little and never lowers it', () => {
    const one = levelOptions(topic('t', { mastery: updateBelief(null, 1, 0) }), 1, 'written')
    expect(one.skip.expectedMarks).toBeCloseTo(1 / 5, 10)
    const wrong = levelOptions(topic('t', { mastery: updateBelief(null, 0, 3) }), 1, 'mcq')
    expect(wrong.skip.expectedMarks).toBeCloseTo(0.25, 10)
    expect(wrong.full.expectedMarks).toBeCloseTo(0.9, 10)
  })
})
