import type { Question } from '@shared/domain'
import { AiError, type LlmProvider } from '@shared/ai/provider'
import { gradeOutputSchema, type GradeOutput } from '@shared/ai/schemas'
import { GRADE_SYSTEM, buildGradeUser } from '../prompts/grade'
import { clamp, cleanStrings } from '../quality/text'
import type { WithUsage } from '../types'
import { usageRecord } from './common'

export interface GradeResult {
  score: number
  verdict: 'correct' | 'partial' | 'incorrect'
  feedback: string
  missingPoints: string[]
}

const MAX_MISSING_POINTS = 10

/** Verdict implied by a score, using the thresholds the grading prompt defines. */
export function verdictFor(score: number): GradeResult['verdict'] {
  if (score >= 0.8) return 'correct'
  if (score <= 0.2) return 'incorrect'
  return 'partial'
}

/**
 * Clamps the score to 0..1 and derives the verdict from it, so score and verdict never
 * disagree on screen (the model's own verdict is only a hint to the same thresholds).
 */
export function reconcileGrade(raw: GradeOutput): GradeResult {
  const score = clamp(raw.score, 0, 1, 0)
  const feedback = raw.feedback.trim()
  return {
    score,
    verdict: verdictFor(score),
    feedback: feedback === '' ? 'No feedback was given.' : feedback,
    missingPoints: cleanStrings(raw.missing_points, MAX_MISSING_POINTS)
  }
}

/** Short answers only; objective types are graded deterministically elsewhere. */
export async function gradeShortAnswer(
  provider: LlmProvider,
  input: { question: Question; response: string; signal?: AbortSignal }
): Promise<WithUsage<GradeResult>> {
  const { answer } = input.question
  if (answer.type !== 'short')
    throw new AiError('unknown', `gradeShortAnswer needs a short-answer question, got ${answer.type}`, {
      retryable: false
    })
  // An empty answer needs no model to be graded.
  if (input.response.trim() === '')
    return {
      value: {
        score: 0,
        verdict: 'incorrect',
        feedback: 'No answer was given.',
        missingPoints: [...answer.rubric]
      },
      usage: []
    }
  const res = await provider.generate({
    task: 'grade',
    system: GRADE_SYSTEM,
    parts: [
      {
        type: 'text',
        text: buildGradeUser({
          stem: input.question.stem,
          modelAnswer: answer.modelAnswer,
          rubric: answer.rubric,
          response: input.response
        })
      }
    ],
    schema: gradeOutputSchema,
    tier: 'smart',
    effort: 'low',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  return { value: reconcileGrade(res.data), usage: [usageRecord('grade', res)] }
}
