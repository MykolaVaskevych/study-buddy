import { solvePlan } from './index'
import type { PlanInput, PlanTopic } from './types'

const topic = (id: string, weight: number): PlanTopic => ({
  id,
  title: id,
  examWeight: weight,
  coreFraction: 0.6,
  coreMinutes: 60,
  fullMinutes: 120,
  prerequisites: [],
  mastery: null,
  minutesSpent: 0
})
const input: PlanInput = {
  examDate: null,
  totalHours: 4,
  hoursPerDay: null,
  targetScore: 0.8,
  mode: 'max_score',
  format: 'written',
  overrides: []
}

describe('pace', () => {
  const topics = [topic('a', 0.4), topic('b', 0.35), topic('c', 0.25)]

  it('a slower pace makes topics cost more, so the same budget covers less', () => {
    const normal = solvePlan(topics, input)
    const slow = solvePlan(topics, { ...input, pace: 2 })
    expect(slow.expectedScore).toBeLessThan(normal.expectedScore)
  })

  it('a faster pace lets the same budget cover more', () => {
    const normal = solvePlan(topics, input)
    const fast = solvePlan(topics, { ...input, pace: 0.5 })
    expect(fast.expectedScore).toBeGreaterThan(normal.expectedScore)
  })

  it('pace 1 is the same as no pace', () => {
    expect(solvePlan(topics, { ...input, pace: 1 })).toEqual(solvePlan(topics, input))
  })
})
