import { DEFAULT_ROUTING, resolveRoutes, ROUTED_TASKS, ROUTING_PRESETS } from '@shared/ai/routing'
import { weakBatch } from './routing'

describe('routing presets', () => {
  it('cover every task, and overrides win over the preset', () => {
    for (const preset of Object.values(ROUTING_PRESETS)) {
      expect(Object.keys(preset).sort()).toEqual(ROUTED_TASKS.map((t) => t.task).sort())
    }
    const routes = resolveRoutes({
      ...DEFAULT_ROUTING,
      overrides: [{ task: 'cards', tier: 'smart', effort: 'high' }]
    })
    expect(routes.cards).toEqual({ tier: 'smart', effort: 'high' })
    expect(routes.index).toEqual(ROUTING_PRESETS.balanced.index)
  })

  it('balanced puts bulk drafting on the fast model and judgement on the strong one', () => {
    const b = ROUTING_PRESETS.balanced
    expect([b.index.tier, b.cards.tier, b.page_check.tier]).toEqual(['fast', 'fast', 'fast'])
    expect([b.topics.tier, b.questions.tier, b.verify.tier, b.grade.tier]).toEqual([
      'smart',
      'smart',
      'smart',
      'smart'
    ])
  })
})

describe('weakBatch', () => {
  it('flags empty, mostly failing or too-small batches', () => {
    expect(weakBatch(6, 0, 4)).toBe(true)
    expect(weakBatch(10, 5, 4)).toBe(true) // half failed the page check
    expect(weakBatch(3, 1, 4)).toBe(true) // too few for the request
    expect(weakBatch(6, 5, 4)).toBe(false)
    expect(weakBatch(0, 0, 0)).toBe(false)
  })
})
