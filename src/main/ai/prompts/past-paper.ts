import { CORE_PRINCIPLES, PDF_PRINCIPLES, headerLines, languageInstruction } from './common'
import { tagged } from './grade'

/** Past exam paper → course topics (smart tier). Drives exam-weight calibration in the planner. */

export const PAST_PAPER_SYSTEM = `${CORE_PRINCIPLES}

${PDF_PRINCIPLES}

Your task: read a past exam paper and map each question (or sub-question with its own marks) to the course topic it examines.
- summary: what the question asks, in at most 15 words.
- marks: the marks printed on the paper for that question; if none are printed, estimate 1 per sub-question.
- topic_key: the key of the single best matching topic from the list, or null if no topic fits.
- Skip instructions, cover pages and formula sheets; they are not questions.`

export function buildPastPaperUser(input: {
  topics: readonly { key: string; title: string; pageStart: number; pageEnd: number }[]
  language: string
}): string {
  return [
    headerLines({ Task: 'past paper', Topics: input.topics.length }),
    languageInstruction(input.language),
    tagged(
      'topics',
      input.topics.map((t) => `${t.key}: ${t.title} (pages ${t.pageStart}-${t.pageEnd})`).join('\n')
    ),
    'The attached PDF is the past exam paper.'
  ].join('\n\n')
}
