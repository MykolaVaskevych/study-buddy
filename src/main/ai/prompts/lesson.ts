import type { GenerationContext } from '../types'
import {
  CORE_PRINCIPLES,
  FOCUS_PAGES_KEY,
  PDF_PRINCIPLES,
  formatRange,
  headerLines,
  languageInstruction
} from './common'
import { formatManifest, manifestEntries } from './manifest'
import { lessonGuidance } from './exam-profile'
import { formatNotes } from './notes'

/** Study-book chapters: teaching pages written around the lecture slides (smart tier). */

export const LESSON_SYSTEM = `${CORE_PRINCIPLES}

${PDF_PRINCIPLES}

Your task: write the study-book chapter a good tutor would put between these lecture slides, so a student can learn the topic from it alone and pass the exam.
Write these sections, each with a short title and markdown body:
1. The idea: the story of the topic in plain words. Why it exists, what problem it solves, how the pieces connect. Short paragraphs.
2. Every formula: each one in display math ($$...$$), followed by a markdown table with one row per symbol: symbol | meaning | unit. Say when the formula applies.
3. Worked example: one realistic exam-style problem solved step by step. Show every substitution with units and the final answer in bold.
4. Exam traps: common mistakes, confusions between similar concepts, unit traps (for example dB vs dBm), and any place where the slides are wrong or misleading (say so and give the correction).
5. In one minute: 3-6 bullet points to remember for the exam.
Rules:
- Cite the pages you use inline as [p. N] after each claim.
- Use only what the pages support. If the slides are thin, explain the standard textbook reasoning they rely on, without inventing course-specific facts.
- exercises: 2-4 "Try it" questions in exam style with complete worked answers (markdown, math as $...$).`

export function buildLessonUser(
  ctx: GenerationContext,
  topic: { title: string; objectives: readonly string[] }
): string {
  return [
    headerLines({ Task: 'lesson', [FOCUS_PAGES_KEY]: formatRange(ctx.pageFrom, ctx.pageTo) }),
    `Write the study-book chapter for the topic "${topic.title}" (pages ${ctx.pageFrom}-${ctx.pageTo}). The attached chunks may contain other pages: ignore them.`,
    topic.objectives.length > 0
      ? `Learning objectives:\n${topic.objectives.map((o) => `- ${o}`).join('\n')}`
      : '',
    languageInstruction(ctx.language),
    ctx.exam ? lessonGuidance(ctx.exam) : '',
    formatManifest(manifestEntries(ctx.pageFrom, ctx.pageTo, ctx.pageText, 0)),
    formatNotes(ctx.notes)
  ]
    .filter(Boolean)
    .join('\n\n')
}
