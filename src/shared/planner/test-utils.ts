/** Test helpers for the planner suites (not exported from index.ts). */
import type { ExamFormat, PlanInput, PlanMode, PlanTopic, TopicOverride } from './types'

/** Deterministic PRNG (mulberry32) so random tests are reproducible. */
export function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function topic(id: string, over: Partial<PlanTopic> = {}): PlanTopic {
  return {
    id,
    title: over.title ?? id,
    examWeight: 0.1,
    coreFraction: 0.5,
    coreMinutes: 60,
    fullMinutes: 120,
    prerequisites: [],
    mastery: null,
    minutesSpent: 0,
    ...over
  }
}

export function planInput(over: Partial<PlanInput> = {}): PlanInput {
  return {
    examDate: null,
    totalHours: null,
    hoursPerDay: null,
    targetScore: 0.7,
    mode: 'max_score',
    format: 'written',
    overrides: [],
    ...over
  }
}

/** A random instance: topics with random estimates, beliefs, prerequisites (cycles allowed) and pins. */
export function randomInstance(
  rand: () => number,
  n: number,
  opts: { prereqChance?: number; pinChance?: number } = {}
): { topics: PlanTopic[]; input: PlanInput } {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)] as T
  const topics: PlanTopic[] = []
  for (let i = 0; i < n; i++) {
    const core = Math.round(rand() * 40) * 5
    const studied = rand() < 0.2
    const quizzed = rand() < 0.25
    topics.push(
      topic(`t${i}`, {
        examWeight: rand() < 0.1 ? 0 : Math.round(rand() * 300) / 1000,
        coreFraction: Math.round(rand() * 100) / 100,
        coreMinutes: core,
        fullMinutes: core + Math.round(rand() * 40) * 5,
        minutesSpent: studied ? Math.round(rand() * 60) * 5 : 0,
        mastery: quizzed ? { alpha: 1 + Math.floor(rand() * 12), beta: 1 + Math.floor(rand() * 6) } : null
      })
    )
  }
  const prereqChance = opts.prereqChance ?? 0.25
  for (const t of topics) {
    for (const other of topics) if (other !== t && rand() < prereqChance) t.prerequisites.push(other.id)
    if (rand() < 0.05) t.prerequisites.push('unknown-topic')
  }
  const overrides: TopicOverride[] = []
  for (const t of topics) {
    if (rand() < (opts.pinChance ?? 0.12))
      overrides.push({ topicId: t.id, level: pick(['skip', 'core', 'full'] as const) })
    if (rand() < 0.08) overrides.push({ topicId: t.id, examWeight: Math.round(rand() * 400) / 1000 })
  }
  const formats: readonly ExamFormat[] = ['mcq', 'written', 'numeric', 'mixed']
  const modes: readonly PlanMode[] = ['max_score', 'min_time']
  return {
    topics,
    input: planInput({
      targetScore: Math.round(rand() * 100) / 100,
      mode: pick(modes),
      format: pick(formats),
      overrides
    })
  }
}
