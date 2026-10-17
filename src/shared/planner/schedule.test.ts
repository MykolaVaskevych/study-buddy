import { buildSchedule } from './schedule'
import { solvePlan } from './solver'
import { prng, planInput, randomInstance, topic } from './test-utils'
import type { PlanInput, PlanTopic, Schedule } from './types'

const TODAY = '2026-10-17'
const learnMinutes = (s: Schedule): number =>
  s.days.flatMap((d) => d.sessions).reduce((sum, x) => sum + (x.kind === 'learn' ? x.minutes : 0), 0)

/** True if `from` (transitively) has `to` among its prerequisites. */
function dependsOn(ts: PlanTopic[], from: string, to: string): boolean {
  const seen = new Set<string>()
  const stack = [from]
  while (stack.length > 0) {
    const id = stack.pop() ?? ''
    for (const p of ts.find((t) => t.id === id)?.prerequisites ?? []) {
      if (p === to) return true
      if (!seen.has(p)) {
        seen.add(p)
        stack.push(p)
      }
    }
  }
  return false
}

const topics: PlanTopic[] = [
  topic('basics', { title: 'Fiber loss', examWeight: 0.1, coreMinutes: 60, fullMinutes: 150 }),
  topic('cd', {
    title: 'Chromatic dispersion',
    examWeight: 0.3,
    coreMinutes: 60,
    fullMinutes: 180,
    prerequisites: ['basics']
  }),
  topic('osnr', {
    title: 'OSNR budget',
    examWeight: 0.3,
    coreMinutes: 45,
    fullMinutes: 120,
    prerequisites: ['cd']
  }),
  topic('amps', { title: 'Amplifiers', examWeight: 0.2, coreMinutes: 60, fullMinutes: 90 }),
  topic('nl', { title: 'Nonlinear effects', examWeight: 0.1, coreMinutes: 240, fullMinutes: 400 })
]

function scheduleFor(input: PlanInput, today = TODAY) {
  const plan = solvePlan(topics, input, { today })
  return { plan, schedule: buildSchedule(plan, topics, input, today) }
}

describe('buildSchedule', () => {
  const input = planInput({ examDate: '2026-10-24', hoursPerDay: 2 })
  const { plan, schedule } = scheduleFor(input)

  it('covers today up to the day before the exam', () => {
    expect(schedule.days.map((d) => d.date)).toEqual([
      '2026-10-17',
      '2026-10-18',
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23'
    ])
  })

  it('keeps every day within the daily limit and totals consistent', () => {
    for (const d of schedule.days) {
      expect(d.totalMinutes).toBeLessThanOrEqual(120)
      expect(d.totalMinutes).toBe(d.sessions.reduce((s, x) => s + x.minutes, 0))
    }
  })

  it('schedules exactly the planned learn minutes, each session followed by a check', () => {
    expect(plan.plannedMinutes).toBeGreaterThan(0)
    expect(learnMinutes(schedule)).toBe(plan.plannedMinutes)
    for (const d of schedule.days) {
      d.sessions.forEach((s, i) => {
        if (s.kind === 'learn') {
          expect(s.minutes).toBeLessThanOrEqual(75)
          expect(d.sessions[i + 1]).toMatchObject({ kind: 'check', topicId: s.topicId })
          expect(d.sessions[i + 1]?.minutes).toBeGreaterThanOrEqual(5)
        }
      })
    }
  })

  it('learns prerequisites before their dependents', () => {
    const order = schedule.days.flatMap((d) => d.sessions).filter((s) => s.kind === 'learn')
    const first = (id: string) => order.findIndex((s) => s.topicId === id)
    const last = (id: string) => order.map((s) => s.topicId).lastIndexOf(id)
    expect(first('basics')).toBeGreaterThanOrEqual(0)
    expect(last('basics')).toBeLessThan(first('cd'))
    expect(last('cd')).toBeLessThan(first('osnr'))
  })

  it('uses readable labels', () => {
    const labels = schedule.days.flatMap((d) => d.sessions.map((s) => s.label))
    expect(labels.some((l) => /^Learn \((core|full)\): Fiber loss/.test(l))).toBe(true)
    expect(labels).toContain('Check: page quiz (Fiber loss)')
    expect(labels).toContain('Review due cards')
  })

  it('places mock exams at the end and review grows toward the exam', () => {
    const big = planInput({ examDate: '2026-10-31', hoursPerDay: 3 })
    const { schedule: s } = scheduleFor(big)
    const mockDays = s.days
      .map((d, i) => (d.sessions.some((x) => x.kind === 'mock') ? i : -1))
      .filter((i) => i >= 0)
    expect(mockDays.length).toBeGreaterThanOrEqual(1)
    expect(mockDays.length).toBeLessThanOrEqual(2)
    expect(Math.min(...mockDays)).toBeGreaterThanOrEqual(s.days.length - 2)
    for (const i of mockDays) expect(s.days[i]?.sessions.at(-1)?.kind).toBe('mock')
    const review = s.days.map((d) =>
      d.sessions.filter((x) => x.kind === 'review').reduce((a, x) => a + x.minutes, 0)
    )
    expect(review.at(-1) ?? 0).toBeGreaterThanOrEqual(review[0] ?? 0)
  })

  it('handles no exam date by spreading the budget at hours per day', () => {
    const noDate = planInput({ totalHours: 9, hoursPerDay: 1.5 })
    const { plan: p, schedule: s } = scheduleFor(noDate)
    expect(s.days).toHaveLength(6)
    expect(s.days[0]?.date).toBe(TODAY)
    for (const d of s.days) expect(d.totalMinutes).toBeLessThanOrEqual(90)
    expect(learnMinutes(s)).toBe(p.plannedMinutes)
    const defaults = scheduleFor(planInput({ totalHours: 5 }))
    expect(defaults.schedule.days).toHaveLength(3)
  })

  it('handles an exam tomorrow: one day, nothing lost', () => {
    const tomorrow = planInput({ examDate: '2026-10-18', hoursPerDay: 4 })
    const { plan: p, schedule: s } = scheduleFor(tomorrow)
    expect(s.days.map((d) => d.date)).toEqual([TODAY])
    expect(s.days[0]?.totalMinutes).toBeLessThanOrEqual(240)
    expect(learnMinutes(s)).toBe(p.plannedMinutes)
  })

  it('raises the daily load rather than dropping learning when pins exceed the calendar', () => {
    const pinned = planInput({
      examDate: '2026-10-18',
      hoursPerDay: 1,
      overrides: [{ topicId: 'nl', level: 'full' }]
    })
    const { plan: p, schedule: s } = scheduleFor(pinned)
    expect(learnMinutes(s)).toBe(p.plannedMinutes)
    expect(s.days).toHaveLength(1)
  })

  it('is deterministic and rejects a bad date', () => {
    expect(scheduleFor(input).schedule).toEqual(schedule)
    expect(() => buildSchedule(plan, topics, input, 'tomorrow')).toThrow(RangeError)
  })

  it('holds its invariants on random plans', () => {
    const rand = prng(99)
    for (let run = 0; run < 150; run++) {
      const { topics: ts, input: base } = randomInstance(rand, 3 + Math.floor(rand() * 12), { pinChance: 0 })
      const days = 1 + Math.floor(rand() * 14)
      const examDate = new Date(Date.UTC(2026, 9, 17 + days)).toISOString().slice(0, 10)
      const input = { ...base, examDate, hoursPerDay: 1 + Math.floor(rand() * 8) / 2 }
      const p = solvePlan(ts, input, { today: TODAY })
      const s = buildSchedule(p, ts, input, TODAY)
      expect(s.days).toHaveLength(days)
      expect(learnMinutes(s), `run ${run}`).toBe(p.plannedMinutes)
      for (const d of s.days) expect(d.totalMinutes, `run ${run}`).toBeLessThanOrEqual(input.hoursPerDay * 60)
      const seq = s.days.flatMap((d) => d.sessions).filter((x) => x.kind === 'learn')
      for (const t of ts) {
        const firstMine = seq.findIndex((x) => x.topicId === t.id)
        if (firstMine < 0) continue
        for (const pre of t.prerequisites) {
          const lastPre = seq.map((x) => x.topicId).lastIndexOf(pre)
          const cyclic = dependsOn(ts, pre, t.id)
          if (lastPre >= 0 && !cyclic)
            expect(lastPre, `run ${run}: ${pre} before ${t.id}`).toBeLessThan(firstMine)
        }
      }
    }
  })
})
