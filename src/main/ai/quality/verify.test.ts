import type { QuestionAnswer } from '@shared/domain'
import type { QuestionDraft } from '../types'
import { applyBlindAnswers, compareAnswer, numericAgrees, verifyId, type BlindAnswer } from './verify'

function blind(over: Partial<BlindAnswer>): BlindAnswer {
  return {
    id: 'q1',
    choice_index: null,
    choice_indices: null,
    tf_answer: null,
    numeric_value: null,
    answerable: true,
    ...over
  }
}

describe('compareAnswer', () => {
  const mcq: QuestionAnswer = { type: 'mcq', correctIndex: 2 }
  const multi: QuestionAnswer = { type: 'multi', correctIndices: [0, 3] }
  const tf: QuestionAnswer = { type: 'tf', value: true }
  const numeric: QuestionAnswer = { type: 'numeric', value: 10, tolerance: 0.02, unit: 'dB' }

  it('compares mcq by index', () => {
    expect(compareAnswer(mcq, blind({ choice_index: 2 }))).toBe('agree')
    expect(compareAnswer(mcq, blind({ choice_index: 1 }))).toBe('disagree')
  })

  it('compares multi as sets', () => {
    expect(compareAnswer(multi, blind({ choice_indices: [3, 0, 0] }))).toBe('agree')
    expect(compareAnswer(multi, blind({ choice_indices: [0] }))).toBe('disagree')
    expect(compareAnswer(multi, blind({ choice_indices: [0, 3, 1] }))).toBe('disagree')
  })

  it('compares tf by value', () => {
    expect(compareAnswer(tf, blind({ tf_answer: true }))).toBe('agree')
    expect(compareAnswer(tf, blind({ tf_answer: false }))).toBe('disagree')
  })

  it('compares numeric within the relative tolerance', () => {
    expect(compareAnswer(numeric, blind({ numeric_value: 10.15 }))).toBe('agree')
    expect(compareAnswer(numeric, blind({ numeric_value: 10.5 }))).toBe('disagree')
  })

  it('reports unanswerable and missing answers', () => {
    expect(compareAnswer(mcq, blind({ choice_index: 2, answerable: false }))).toBe('unanswerable')
    expect(compareAnswer(mcq, blind({ choice_index: null }))).toBe('missing')
    expect(compareAnswer(mcq, undefined)).toBe('missing')
  })
})

describe('numericAgrees', () => {
  it('absorbs rounding even with zero tolerance', () => {
    expect(numericAgrees(3.1416, 3.14, 0)).toBe(true)
    expect(numericAgrees(3.1416, 3.1, 0)).toBe(false)
  })

  it('handles a zero key', () => {
    expect(numericAgrees(0, 0, 0.02)).toBe(true)
    expect(numericAgrees(0, 0.01, 0.02)).toBe(false)
  })
})

describe('applyBlindAnswers', () => {
  function draft(
    answer: QuestionAnswer,
    verification: QuestionDraft['verification'] = 'verified'
  ): QuestionDraft {
    return {
      type: answer.type,
      stem: `stem ${answer.type}`,
      options: answer.type === 'mcq' || answer.type === 'multi' ? ['a', 'b', 'c', 'd'] : null,
      answer,
      explanation: '',
      optionRationales: null,
      difficulty: 2,
      sourcePages: [1],
      evidence: 'e',
      verification
    }
  }

  it('drops disagreements and unanswerable questions, keeps agreements and short answers', () => {
    const drafts = [
      draft({ type: 'mcq', correctIndex: 1 }),
      draft({ type: 'tf', value: true }),
      draft({ type: 'short', modelAnswer: 'x', rubric: [] }),
      draft({ type: 'numeric', value: 5, tolerance: 0, unit: null }, 'not_applicable'),
      draft({ type: 'multi', correctIndices: [0, 1] })
    ]
    const kept = applyBlindAnswers(drafts, {
      answers: [
        blind({ id: verifyId(0), choice_index: 1 }),
        blind({ id: verifyId(1), tf_answer: false }),
        blind({ id: verifyId(3), numeric_value: 5 }),
        blind({ id: verifyId(4), choice_indices: [0, 1], answerable: false })
      ]
    })
    expect(kept.map((q) => [q.type, q.verification])).toEqual([
      ['mcq', 'verified'],
      ['short', 'verified'],
      ['numeric', 'not_applicable']
    ])
  })

  it('keeps questions the verifier skipped but downgrades verified to unverified', () => {
    const kept = applyBlindAnswers(
      [draft({ type: 'mcq', correctIndex: 0 }), draft({ type: 'tf', value: true }, 'not_applicable')],
      {
        answers: []
      }
    )
    expect(kept.map((q) => q.verification)).toEqual(['unverified', 'not_applicable'])
  })
})
