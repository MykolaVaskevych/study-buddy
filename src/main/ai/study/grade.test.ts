import { reconcileGrade, verdictFor } from './grade'

describe('reconcileGrade', () => {
  it('clamps the score and derives a consistent verdict', () => {
    expect(reconcileGrade({ score: 1.4, verdict: 'partial', feedback: ' ok ', missing_points: [] })).toEqual({
      score: 1,
      verdict: 'correct',
      feedback: 'ok',
      missingPoints: []
    })
    expect(
      reconcileGrade({ score: -0.2, verdict: 'correct', feedback: '', missing_points: [' a ', 'a', ''] })
    ).toEqual({
      score: 0,
      verdict: 'incorrect',
      feedback: 'No feedback was given.',
      missingPoints: ['a']
    })
    expect(
      reconcileGrade({ score: Number.NaN, verdict: 'correct', feedback: 'x', missing_points: [] }).score
    ).toBe(0)
  })

  it('uses the prompt thresholds', () => {
    expect([0, 0.2, 0.21, 0.79, 0.8, 1].map(verdictFor)).toEqual([
      'incorrect',
      'incorrect',
      'partial',
      'partial',
      'correct',
      'correct'
    ])
  })
})
