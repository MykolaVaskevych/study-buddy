import { solvePlan } from './solver'
import { modelTopics, overridesById } from './model'
import { REACH_TOLERANCE, SCORE_SCALE, quantise } from './search'
import { prng, randomInstance } from './test-utils'
import type { PlanInput, PlanResult, PlanTopic, StudyLevel } from './types'

const LEVELS: StudyLevel[] = ['skip', 'core', 'full']
const SLOT = 15

type Key = number[]
const better = (a: Key, b: Key | null): boolean => {
  if (!b) return true
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return (a[i] ?? 0) > (b[i] ?? 0)
  return false
}

/** Enforced prerequisite edges, as the planner defines them (unknown, self and user-skipped ignored). */
function edges(topics: PlanTopic[], input: PlanInput): [number, number][] {
  const pins = overridesById(input)
  const idx = new Map(topics.map((t, i) => [t.id, i]))
  const out: [number, number][] = []
  topics.forEach((t, i) => {
    for (const id of t.prerequisites) {
      const p = idx.get(id)
      if (p !== undefined && p !== i && pins.get(id)?.level !== 'skip') out.push([i, p])
    }
  })
  return out
}

/** Exhaustive optimum over all 3^n level assignments, with the solver's ordering rules. */
function bruteForce(
  topics: PlanTopic[],
  input: PlanInput,
  budgetMinutes: number
): { key: Key; valid: number } {
  const { models } = modelTopics(topics, input)
  const es = edges(topics, input)
  const n = topics.length
  const assignments: { levels: StudyLevel[]; v: number; s: number; t: number }[] = []
  const levels: StudyLevel[] = new Array<StudyLevel>(n).fill('skip')
  const rec = (i: number): void => {
    if (i === n) {
      if (es.some(([d, p]) => levels[d] !== 'skip' && levels[p] === 'skip')) return
      let v = 0
      let s = 0
      let t = 0
      levels.forEach((lv, k) => {
        const o = models[k]?.options[lv]
        if (!o) return
        v += quantise(o.expectedMarks)
        s += o.slots
        t += o.slots > 0 ? 1 : 0
      })
      assignments.push({ levels: [...levels], v, s, t })
      return
    }
    const forced = models[i]?.forced
    for (const lv of LEVELS) {
      if (forced && forced !== lv) continue
      levels[i] = lv
      rec(i + 1)
    }
  }
  rec(0)
  const minCost = Math.min(...assignments.map((a) => a.s))
  const budget = Math.max(Math.floor(budgetMinutes / SLOT + 1e-9), minCost)
  const fits = assignments.filter((a) => a.s <= budget)
  const targetQ = quantise(input.targetScore) - Math.round(REACH_TOLERANCE * SCORE_SCALE)
  let best: Key | null = null
  if (input.mode === 'min_time') {
    for (const a of fits) if (a.v >= targetQ && better([-a.s, a.v, -a.t], best)) best = [-a.s, a.v, -a.t]
    if (best) return { key: best, valid: fits.length }
  }
  for (const a of fits) if (better([a.v, -a.s, -a.t], best)) best = [a.v, -a.s, -a.t]
  return { key: best ?? [], valid: fits.length }
}

function solverKey(plan: PlanResult, mode: PlanInput['mode']): Key {
  const v = plan.items.reduce((s, it) => s + quantise(it.expectedMarks), 0)
  const reached = v >= quantise(plan.targetScore) - Math.round(REACH_TOLERANCE * SCORE_SCALE)
  const s = plan.plannedMinutes / SLOT
  const t = plan.items.filter((it) => it.minutes > 0).length
  return mode === 'min_time' && reached ? [-s, v, -t] : [v, -s, -t]
}

function assertValid(plan: PlanResult, topics: PlanTopic[], input: PlanInput): void {
  const pins = overridesById(input)
  for (const it of plan.items) {
    const pin = pins.get(it.topicId)?.level
    if (pin) expect(it.level).toBe(pin)
  }
  for (const [d, p] of edges(topics, input)) {
    if (plan.items[d]?.level !== 'skip') expect(plan.items[p]?.level, `prereq of ${d}`).not.toBe('skip')
  }
}

describe('knapsack vs brute force', () => {
  it.each(['max_score', 'min_time'] as const)('matches the exhaustive optimum (%s)', (mode) => {
    const rand = prng(mode === 'max_score' ? 7 : 11)
    for (let run = 0; run < 400; run++) {
      const n = 1 + Math.floor(rand() * 7)
      const { topics, input: base } = randomInstance(rand, n)
      const input = { ...base, mode }
      const fullTotal = topics.reduce((s, t) => s + t.fullMinutes, 0)
      const budgetMinutes = Math.round(rand() * fullTotal * 1.1)
      const plan = solvePlan(topics, input, { budgetMinutes, reserveFraction: 0 })
      const bf = bruteForce(topics, input, budgetMinutes)
      assertValid(plan, topics, input)
      expect(solverKey(plan, mode), `run ${run}`).toEqual(bf.key)
    }
  })

  it('also matches with dense prerequisite graphs and many pins', () => {
    const rand = prng(2024)
    for (let run = 0; run < 300; run++) {
      const { topics, input } = randomInstance(rand, 7, { prereqChance: 0.45, pinChance: 0.25 })
      const budgetMinutes = Math.round(rand() * 900)
      const plan = solvePlan(topics, input, { budgetMinutes, reserveFraction: 0 })
      assertValid(plan, topics, input)
      expect(solverKey(plan, input.mode), `run ${run}`).toEqual(bruteForce(topics, input, budgetMinutes).key)
    }
  })
})
