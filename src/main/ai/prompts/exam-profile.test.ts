import type { ExamProfile } from '@shared/domain'
import { cardGuidance, cardMix, defaultProfile, questionGuidance, questionTypesFor } from './exam-profile'

const profile = (over: Partial<ExamProfile>): ExamProfile => ({ ...defaultProfile('d', 'mixed'), ...over })

describe('exam profile guidance', () => {
  it('a conceptual MCQ exam gets no formula cards and more why/compare cards', () => {
    const p = profile({ formats: { mcq: 1, written: 0, numeric: 0 }, formulas: 'none' })
    const mix = cardMix(p)
    expect(mix.formula).toBe(0)
    expect(Object.values(mix).reduce((a, b) => a + b, 0)).toBeCloseTo(1)
    expect(mix.contrast + mix.why).toBeGreaterThan(0.5)
    expect(cardGuidance(p)).toMatch(/no formula cards/)
    expect(questionTypesFor(p)).toEqual(['mcq', 'multi', 'tf'])
  })

  it('a formula sheet means formulas are understood, not memorised', () => {
    expect(cardGuidance(profile({ formulas: 'recognise', formulaSheet: true }))).toMatch(
      /never ask to reproduce/
    )
  })

  it('calculation exams keep numeric questions and formula cards', () => {
    const p = profile({ formats: { mcq: 0.2, written: 0.2, numeric: 0.6 }, formulas: 'apply' })
    expect(questionTypesFor(p)).toContain('numeric')
    expect(cardMix(p).formula).toBeGreaterThan(0.2)
  })

  it('passes the past paper style and examples to question prompts', () => {
    const g = questionGuidance(profile({ style: 'Conceptual MCQs.', examples: ['Which is true? A. x B. y'] }))
    expect(g).toMatch(/Conceptual MCQs/)
    expect(g).toMatch(/Which is true/)
  })

  it('derives a default from the planner exam format', () => {
    expect(defaultProfile('d', 'mcq')).toMatchObject({ formats: { mcq: 1 }, source: 'default' })
  })
})
