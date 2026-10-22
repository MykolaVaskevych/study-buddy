import type { Card } from '@shared/domain'
import { formatNextDue, initialReview, recallRate, reviewKeyAction, reviewReducer } from './session'
import type { ReviewAction, ReviewState } from './session'

const card = (id: string): Card =>
  ({
    id,
    docId: 'd',
    topicId: null,
    type: 'basic',
    front: id,
    back: 'back',
    essential: true,
    sourcePages: [1],
    evidence: null,
    verification: 'verified',
    status: 'active',
    createdAt: ''
  }) as Card

const start = (...actions: ReviewAction[]): ReviewState =>
  actions.reduce(reviewReducer, initialReview([card('a'), card('b'), card('c')]))

describe('reviewReducer', () => {
  it('rates the current card and moves on', () => {
    const s = start({ type: 'flip' }, { type: 'rated', cardId: 'a', rating: 3 })
    expect(s.pending.map((c) => c.id)).toEqual(['b', 'c'])
    expect(s).toMatchObject({ pos: 0, flipped: false })
    expect(s.log).toEqual([{ cardId: 'a', rating: 3 }])
  })

  it('requeues a lapsed card at the end once', () => {
    const s = start({ type: 'rated', cardId: 'a', rating: 1 }, { type: 'requeue', card: card('a') })
    expect(s.pending.map((c) => c.id)).toEqual(['b', 'c', 'a'])
    expect(reviewReducer(s, { type: 'requeue', card: card('a') })).toBe(s)
  })

  it('rotates short-interval Good reviews without duplicates for more than fifty ratings', () => {
    const cards = Array.from({ length: 10 }, (_, i) => card(String(i)))
    let state = initialReview(cards)
    for (let i = 0; i < 55; i++) {
      const current = state.pending[state.pos]
      if (!current) throw new Error('Missing current card')
      expect(current.id).toBe(String(i % cards.length))
      state = reviewReducer(state, { type: 'rated', cardId: current.id, rating: 3 })
      state = reviewReducer(state, { type: 'requeue', card: current })
      expect(state.pending[state.pos]?.id).not.toBe(current.id)
      expect(new Set(state.pending.map((c) => c.id)).size).toBe(10)
      expect(state.pending).toHaveLength(10)
      expect(reviewReducer(state, { type: 'requeue', card: current })).toBe(state)
    }
    expect(state.log).toHaveLength(55)
    expect(recallRate(state.log)).toBe(1)
  })

  it('moves with wrap-around and wraps after rating the last card', () => {
    const s = start({ type: 'move', delta: -1 })
    expect(s.pos).toBe(2)
    expect(reviewReducer(s, { type: 'rated', cardId: 'c', rating: 4 }).pos).toBe(0)
  })

  it('restores a card whose rating failed', () => {
    const s = start(
      { type: 'rated', cardId: 'a', rating: 2 },
      { type: 'restore', card: card('a'), rating: 2 }
    )
    expect(s.pending.map((c) => c.id)).toEqual(['a', 'b', 'c'])
    expect(s.log).toEqual([])
  })

  it('removes suspended cards and replaces edited ones', () => {
    const s = start({ type: 'move', delta: 1 }, { type: 'remove', cardId: 'a' })
    expect(s.pending.map((c) => c.id)).toEqual(['b', 'c'])
    expect(s.pos).toBe(0)
    const edited = reviewReducer(s, { type: 'replace', card: { ...card('b'), front: 'new' } })
    expect(edited.pending[0]?.front).toBe('new')
  })
})

describe('recallRate', () => {
  it('counts Hard, Good and Easy as recalled', () => {
    expect(recallRate([])).toBeNull()
    expect(
      recallRate([
        { cardId: 'a', rating: 1 },
        { cardId: 'b', rating: 2 },
        { cardId: 'c', rating: 3 },
        { cardId: 'd', rating: 4 }
      ])
    ).toBe(0.75)
  })
})

describe('reviewKeyAction', () => {
  const key = (k: string, ctrlKey = false) => ({
    key: k,
    ctrlKey,
    metaKey: false,
    altKey: false,
    shiftKey: false
  })
  it('maps the review keys', () => {
    expect(reviewKeyAction(key(' '))).toEqual({ type: 'flip' })
    expect(reviewKeyAction(key('3'))).toEqual({ type: 'rate', rating: 3 })
    expect(reviewKeyAction(key('j'))).toEqual({ type: 'move', delta: 1 })
    expect(reviewKeyAction(key('k'))).toEqual({ type: 'move', delta: -1 })
    expect(reviewKeyAction(key('e'))).toEqual({ type: 'edit' })
    expect(reviewKeyAction(key('s'))).toEqual({ type: 'suspend' })
    expect(reviewKeyAction(key('5'))).toBeNull()
    expect(reviewKeyAction(key('2', true))).toBeNull()
  })
})

describe('formatNextDue', () => {
  const now = new Date(2026, 9, 17, 10, 0)
  it('describes the next due time', () => {
    expect(formatNextDue(new Date(2026, 9, 17, 10, 25).toISOString(), now)).toBe('in 25 minutes')
    expect(formatNextDue(new Date(2026, 9, 17, 13, 0).toISOString(), now)).toMatch(/^in 3 hours, at /)
    expect(formatNextDue(new Date(2026, 9, 18, 9, 0).toISOString(), now)).toMatch(/^tomorrow at /)
    expect(formatNextDue(new Date(2026, 9, 21, 9, 0).toISOString(), now)).toBe('in 4 days')
  })
})
