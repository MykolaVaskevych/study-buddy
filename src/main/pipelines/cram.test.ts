import type { Card, Topic } from '@shared/domain'
import { cramRank, pickCram } from './cram'
import { createHarness, type Harness } from './test-harness'

const srs = (over: Partial<Card['srs']> = {}): Card['srs'] => ({
  due: '2026-10-21T10:00:00.000Z',
  stability: 0,
  difficulty: 5,
  reps: 0,
  lapses: 0,
  state: 'new',
  lastReview: null,
  elapsedDays: 0,
  scheduledDays: 0,
  learningSteps: 0,
  ...over
})

const card = (id: string, over: Partial<Card> = {}): Card => ({
  id,
  docId: 'd1',
  topicId: null,
  type: 'basic',
  front: id,
  back: 'b',
  essential: true,
  sourcePages: [1],
  evidence: null,
  verification: 'verified',
  status: 'active',
  srs: srs(),
  createdAt: '2026-10-17T10:00:00.000Z',
  ...over
})

const topic = (id: string, examWeight: number, mastery: number | null = null): Topic =>
  ({ id, docId: 'd1', parentId: null, estimates: { examWeight }, mastery }) as unknown as Topic

const none = new Set<Card['type']>()

describe('cram ranking', () => {
  it('puts mistakes and lapses first, then shaky cards, then unseen essentials', () => {
    expect(cramRank(card('m', { type: 'mistake' }))).toBe(0)
    expect(cramRank(card('l', { srs: srs({ lapses: 1, state: 'review' }) }))).toBe(0)
    expect(cramRank(card('s', { srs: srs({ state: 'learning' }) }))).toBe(1)
    expect(cramRank(card('e'))).toBe(2)
    expect(cramRank(card('k', { srs: srs({ state: 'review' }) }))).toBe(3)
    expect(cramRank(card('x', { essential: false }))).toBe(4)
  })
})

describe('pickCram', () => {
  it('spreads slots by exam weight and fills short topics from the rest', () => {
    const cards = [
      ...Array.from({ length: 10 }, (_, i) => card(`a${i}`, { topicId: 'A', sourcePages: [10 + i] })),
      ...Array.from({ length: 10 }, (_, i) => card(`b${i}`, { topicId: 'B', sourcePages: [30 + i] })),
      card('c0', { topicId: 'C', sourcePages: [50] })
    ]
    const picked = pickCram(cards, [topic('A', 0.6), topic('B', 0.2), topic('C', 0.2)], {
      count: 10,
      skip: none
    })
    expect(picked).toHaveLength(10)
    const from = (t: string): number => picked.filter((c) => c.topicId === t).length
    // C has one card for its two slots; the spare slot goes to A, the heavier topic.
    expect([from('A'), from('B'), from('C')]).toEqual([7, 2, 1])
    const pages = picked.map((c) => c.sourcePages[0] ?? 0)
    expect(pages).toEqual([...pages].sort((a, b) => a - b))
  })

  it('skips excluded types and inactive cards, and prefers what went wrong', () => {
    const cards = [
      card('f', { type: 'formula' }),
      card('gone', { status: 'suspended' }),
      card('known', { srs: srs({ state: 'review', stability: 30 }) }),
      card('new'),
      card('wrong', { type: 'mistake', sourcePages: [9] })
    ]
    const picked = pickCram(cards, [], { count: 2, skip: new Set(['formula']) })
    expect(picked.map((c) => c.id)).toEqual(['new', 'wrong'])
  })

  it('gives mastered topics fewer cards', () => {
    const cards = ['A', 'B'].flatMap((t) =>
      Array.from({ length: 6 }, (_, i) => card(`${t}${i}`, { topicId: t }))
    )
    const picked = pickCram(cards, [topic('A', 0.5, 0.9), topic('B', 0.5, 0.1)], { count: 5, skip: none })
    expect(picked.filter((c) => c.topicId === 'B').length).toBeGreaterThan(
      picked.filter((c) => c.topicId === 'A').length
    )
  })
})

describe('cram.plan', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('builds a plan from stored cards and follows the exam profile', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    await harness.h['exam.saveProfile']({
      docId,
      formats: { mcq: 1, written: 0, numeric: 0 },
      formulas: 'none',
      formulaSheet: false
    })
    const plan = await harness.h['cram.plan']({ docId, cards: 5 })
    expect(plan.cards.length).toBeGreaterThan(0)
    expect(plan.cards.length).toBeLessThanOrEqual(5)
    expect(plan.cards.every((c) => c.type !== 'formula' && c.status === 'active')).toBe(true)
    expect(plan).toMatchObject({ docId, questionCount: 5, questionTypes: ['mcq', 'multi', 'tf'] })
  })
})
