import type { Card, Topic } from '@shared/domain'
import { cramRank, normaliseScopes, pickCram, topicsUnder } from './cram'
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
    // Every topic first, then by weight; C has a single card, so its spare slot goes to A.
    expect([from('A'), from('B'), from('C')]).toEqual([6, 3, 1])
    // Interleaved: each round takes one card per topic, in book order.
    expect(picked.slice(0, 3).map((c) => c.topicId)).toEqual(['A', 'B', 'C'])
    expect(picked.slice(3, 5).map((c) => c.topicId)).toEqual(['A', 'B'])
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
    expect(picked.map((c) => c.id)).toEqual(['wrong', 'new'])
  })

  it('covers as many topics as it has slots, the most important first', () => {
    const topics = Array.from({ length: 12 }, (_, i) => topic(`T${i}`, (12 - i) / 78))
    const cards = topics.flatMap((t, i) =>
      Array.from({ length: 5 }, (_, j) => card(`${t.id}-${j}`, { topicId: t.id, sourcePages: [i * 10 + j] }))
    )
    const picked = pickCram(cards, topics, { count: 10, skip: none })
    expect(new Set(picked.map((c) => c.topicId))).toEqual(new Set(topics.slice(0, 10).map((t) => t.id)))
  })

  it('orders files as given and groups cards without a topic per file', () => {
    const cards = [
      card('w6', { docId: 'week6', sourcePages: [1] }),
      card('w5', { docId: 'week5', sourcePages: [1] })
    ]
    const picked = pickCram(cards, [], { count: 2, skip: none, docOrder: ['week5', 'week6'] })
    expect(picked.map((c) => c.id)).toEqual(['w5', 'w6'])
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

describe('cram scopes', () => {
  it('expands chapters to everything below them', () => {
    const t = (id: string, parentId: string | null): Topic => ({ id, parentId }) as unknown as Topic
    const tree = [t('w5a', 'w5'), t('w5', null), t('w6', null), t('w5a1', 'w5a')]
    expect(topicsUnder(tree, ['w5'])).toEqual(new Set(['w5', 'w5a', 'w5a1']))
  })

  it('merges repeated files; a whole file wins over chapters', () => {
    expect(
      normaliseScopes([
        { docId: 'a', topicIds: ['x'] },
        { docId: 'a', topicIds: ['y', 'x'] },
        { docId: 'b', topicIds: ['z'] },
        { docId: 'b', topicIds: null }
      ])
    ).toEqual([
      { docId: 'a', topicIds: ['x', 'y'] },
      { docId: 'b', topicIds: null }
    ])
  })
})

describe('cram.plan', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('persists short Good review intervals for new cram cards with the exam tomorrow', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    await harness.h['plan.save']({
      docId,
      input: {
        examDate: '2026-10-18',
        totalHours: 3,
        hoursPerDay: null,
        targetScore: 0.8,
        mode: 'max_score',
        format: 'mcq',
        overrides: []
      }
    })
    const plan = await harness.h['cram.plan']({ docId, cards: 10 })
    expect(plan.cards.length).toBeGreaterThan(1)
    expect(plan.cards.every((c) => c.srs.state === 'new')).toBe(true)
    for (let i = 0; i < 55; i++) {
      const card = plan.cards[i % plan.cards.length]
      if (!card) throw new Error('Missing cram card')
      const updated = await harness.h['cards.review']({ cardId: card.id, rating: 3, elapsedMs: 1000 })
      const interval = Date.parse(updated.srs.due) - harness.clock.now().getTime()
      expect(updated.id).toBe(card.id)
      expect(updated.srs.reps).toBe(Math.floor(i / plan.cards.length) + 1)
      expect(interval).toBeGreaterThan(0)
      expect(interval).toBeLessThanOrEqual(10 * 60_000)
      expect(harness.db.cards.get(card.id)).toEqual(updated)
      harness.clock.advance(1000)
    }
  })

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
    expect(plan.scopes).toEqual([{ docId, topicIds: null }])
  })

  it('limits cards to chosen chapters and builds a quiz over them', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    const topics = await harness.h['topics.list']({ docId })
    const chapter = topics.find((t) => t.parentId === null)
    if (!chapter) throw new Error('fixture has no topics')
    const scopes = [{ docId, topicIds: [chapter.id] }]
    const plan = await harness.h['cram.plan']({ docId, cards: 30, scopes })
    const inChapter = new Set(
      topics.filter((t) => t.id === chapter.id || t.parentId === chapter.id).map((t) => t.id)
    )
    expect(plan.cards.every((c) => c.topicId !== null && inChapter.has(c.topicId))).toBe(true)

    const quiz = await harness.h['cram.quiz']({ scopes, count: 3, types: null })
    expect(quiz.questions.length).toBeGreaterThan(0)
    expect(quiz.questions.length).toBeLessThanOrEqual(3)
    expect(quiz.docId).toBe(docId)
  })
})
