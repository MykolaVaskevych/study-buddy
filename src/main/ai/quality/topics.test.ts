import type { TopicMapOutput } from '@shared/ai/schemas'
import { normalizeTopics } from './topics'

type Raw = TopicMapOutput['topics'][number]

function topic(key: string, over: Partial<Raw> = {}): Raw {
  return {
    key,
    parent_key: null,
    title: `Topic ${key}`,
    page_start: 1,
    page_end: 5,
    objectives: ['Be able to explain it'],
    difficulty: 3,
    exam_weight: 0.5,
    exam_weight_reasons: ['practice exam p. 3'],
    core_fraction: 0.6,
    core_minutes: 20,
    full_minutes: 40,
    prerequisite_keys: [],
    ...over
  }
}

const doc = { firstPage: 1, lastPage: 50 }
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0)

describe('normalizeTopics', () => {
  it('normalises leaf weights to 1 and gives parents the sum of their children', () => {
    const out = normalizeTopics(
      [
        topic('ch1', { page_start: 1, page_end: 20, exam_weight: 0.9 }),
        topic('a', { parent_key: 'ch1', page_start: 1, page_end: 10, exam_weight: 2 }),
        topic('b', { parent_key: 'ch1', page_start: 11, page_end: 20, exam_weight: 1 }),
        topic('c', { page_start: 21, page_end: 30, exam_weight: 1 })
      ],
      doc
    )
    const w = Object.fromEntries(out.map((t) => [t.key, t.examWeight]))
    expect(sum([w['a']!, w['b']!, w['c']!])).toBeCloseTo(1)
    expect(w['a']).toBeCloseTo(0.5)
    expect(w['ch1']).toBeCloseTo(0.75)
  })

  it('falls back to page share when no usable weight is given', () => {
    const out = normalizeTopics(
      [
        topic('a', { page_start: 1, page_end: 30, exam_weight: 0 }),
        topic('b', { page_start: 31, page_end: 40, exam_weight: Number.NaN })
      ],
      doc
    )
    expect(out.map((t) => t.examWeight)).toEqual([0.75, 0.25])
  })

  it('clamps difficulty, fraction, minutes and page ranges, and orders by page', () => {
    const out = normalizeTopics(
      [
        topic('late', {
          page_start: 80,
          page_end: 30,
          difficulty: 9,
          core_fraction: 1.7,
          core_minutes: 50,
          full_minutes: 30
        }),
        topic('early', { page_start: -3, page_end: 4, difficulty: 0.2, core_fraction: -1, core_minutes: -5 })
      ],
      doc
    )
    expect(out.map((t) => t.key)).toEqual(['early', 'late'])
    expect(out[0]).toMatchObject({ pageStart: 1, pageEnd: 4, difficulty: 1, coreFraction: 0, coreMinutes: 0 })
    expect(out[1]).toMatchObject({
      pageStart: 30,
      pageEnd: 50,
      difficulty: 5,
      coreFraction: 1,
      coreMinutes: 30,
      fullMinutes: 50
    })
  })

  it('makes keys unique and drops unknown or self parents', () => {
    const out = normalizeTopics(
      [
        topic('x'),
        topic('x', { page_start: 6, page_end: 9 }),
        topic('y', { page_start: 10, page_end: 11, parent_key: 'nope' }),
        topic('z', { page_start: 12, page_end: 14, parent_key: 'z' })
      ],
      doc
    )
    expect(out.map((t) => t.key)).toEqual(['x', 'x-2', 'y', 'z'])
    expect(out.every((t) => t.parentKey === null)).toBe(true)
  })

  it('breaks parent cycles', () => {
    const out = normalizeTopics(
      [topic('a', { parent_key: 'b' }), topic('b', { parent_key: 'a', page_start: 6 })],
      doc
    )
    expect(out.some((t) => t.parentKey === null)).toBe(true)
    const weights = sum(out.filter((t) => !out.some((o) => o.parentKey === t.key)).map((t) => t.examWeight))
    expect(weights).toBeCloseTo(1)
  })

  it('keeps known prerequisites and drops unknown, self, nested and cyclic ones', () => {
    const out = normalizeTopics(
      [
        topic('basics', { page_start: 1, page_end: 5 }),
        topic('loss', {
          page_start: 6,
          page_end: 10,
          prerequisite_keys: ['basics', 'basics', 'ghost', 'loss']
        }),
        topic('budget', { page_start: 11, page_end: 15, prerequisite_keys: ['loss'] }),
        topic('basics-again', {
          page_start: 16,
          page_end: 18,
          parent_key: 'budget',
          prerequisite_keys: ['budget']
        })
      ].concat([topic('cyc', { page_start: 20, page_end: 22, prerequisite_keys: ['budget'] })]),
      doc
    )
    const prereqs = Object.fromEntries(out.map((t) => [t.key, t.prerequisiteKeys]))
    expect(prereqs['loss']).toEqual(['basics'])
    expect(prereqs['budget']).toEqual(['loss'])
    expect(prereqs['basics-again']).toEqual([])
    expect(prereqs['cyc']).toEqual(['budget'])
  })

  it('drops the edge that would close a prerequisite cycle', () => {
    const out = normalizeTopics(
      [
        topic('a', { page_start: 1, prerequisite_keys: ['b'] }),
        topic('b', { page_start: 6, prerequisite_keys: ['a'] })
      ],
      doc
    )
    const prereqs = Object.fromEntries(out.map((t) => [t.key, t.prerequisiteKeys]))
    expect(prereqs).toEqual({ a: ['b'], b: [] })
  })

  it('cleans objectives and reasons, and names untitled topics by pages', () => {
    const [t] = normalizeTopics(
      [
        topic('a', {
          title: ' ',
          objectives: [' x ', 'x', '', 'y'],
          exam_weight_reasons: Array.from({ length: 9 }, (_, i) => `r${i}`)
        })
      ],
      doc
    )
    expect(t).toMatchObject({ title: 'Pages 1–5', objectives: ['x', 'y'] })
    expect(t!.examWeightReasons).toHaveLength(4)
  })
})
