import { buildSchedule } from './schedule'
import { solvePlan } from './solver'
import { prng, planInput, topic } from './test-utils'
import type { PlanInput, PlanTopic } from './types'

/** 60 topics shaped like a real topic map: chapters with prerequisite chains plus cross links. */
function bigDocument(seed: number): PlanTopic[] {
  const rand = prng(seed)
  return Array.from({ length: 60 }, (_, i) => {
    const core = 30 + Math.round(rand() * 20) * 15
    const prerequisites: string[] = []
    if (i % 6 !== 0) prerequisites.push(`t${i - 1}`)
    if (i > 6 && rand() < 0.3) prerequisites.push(`t${Math.floor(rand() * (i - 1))}`)
    return topic(`t${i}`, {
      examWeight: 0.002 + rand() * 0.04,
      coreFraction: 0.3 + rand() * 0.6,
      coreMinutes: core,
      fullMinutes: core + Math.round(rand() * 24) * 15,
      prerequisites,
      mastery: rand() < 0.2 ? { alpha: 1 + Math.floor(rand() * 10), beta: 1 + Math.floor(rand() * 5) } : null
    })
  })
}

function time(fn: () => void, runs: number): { avg: number; max: number } {
  let max = 0
  const start = performance.now()
  for (let i = 0; i < runs; i++) {
    const t0 = performance.now()
    fn()
    max = Math.max(max, performance.now() - t0)
  }
  return { avg: (performance.now() - start) / runs, max }
}

describe('planner performance', () => {
  const cases: [string, PlanInput, number][] = [
    ['max_score, 200 h', planInput({ targetScore: 0.8 }), 200],
    ['min_time, 200 h', planInput({ mode: 'min_time', targetScore: 0.7 }), 200],
    ['max_score, tight 20 h (unreachable target)', planInput({ targetScore: 0.8 }), 20],
    ['min_time, tight 20 h (unreachable target)', planInput({ mode: 'min_time', targetScore: 0.8 }), 20]
  ]

  it.each(cases)('60 topics: %s', (name, input, hours) => {
    const topics = bigDocument(1)
    // Warm-up (JIT), and proof that the search finished exactly instead of hitting its node cap.
    const plan = solvePlan(topics, input, { budgetMinutes: hours * 60, reserveFraction: 0 })
    expect(plan.notes.some((n) => n.includes('search limit'))).toBe(false)
    const { avg, max } = time(
      () => solvePlan(topics, input, { budgetMinutes: hours * 60, reserveFraction: 0 }),
      20
    )
    console.info(`[perf] solvePlan ${name}: avg ${avg.toFixed(2)} ms, max ${max.toFixed(2)} ms`)
    expect(max).toBeLessThan(250)
  })

  it('a slider drag (many budgets in a row) stays interactive, schedule included', () => {
    const topics = bigDocument(2)
    const input = planInput({ examDate: '2026-12-01', hoursPerDay: 3 })
    const { avg, max } = time(() => {
      for (let h = 10; h <= 200; h += 10) {
        const plan = solvePlan(topics, input, { budgetMinutes: h * 60 })
        buildSchedule(plan, topics, input, '2026-10-17')
      }
    }, 3)
    console.info(`[perf] 20 solves + schedules: avg ${avg.toFixed(1)} ms per sweep, max ${max.toFixed(1)} ms`)
    expect(max / 20).toBeLessThan(250)
  })
})
