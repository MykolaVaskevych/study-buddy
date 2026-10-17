import type { ChatMode, ChatTurn } from '@shared/domain'
import type { ChatContextPage } from '../types'
import { CORE_PRINCIPLES, PDF_PRINCIPLES, languageInstruction } from './common'
import { tagged } from './grade'

/** Tutor chat and explain actions (smart tier, streamed markdown). */

export const CHAT_SYSTEM = `${CORE_PRINCIPLES}

${PDF_PRINCIPLES}

Your task: answer a student's questions about their course material like a patient, precise tutor.
- Base the answer on the provided pages. After each claim taken from a page, cite it inline as [p. N] (N = the page number given with that page). Cite only pages you were given.
- If the pages do not cover the question, say so in one sentence, then answer briefly from general knowledge under the heading "Beyond your notes".
- Be concise and exam-focused: lead with the answer, then the reasoning. Use short paragraphs or bullet points, markdown only (no HTML), math as $...$ LaTeX.
- Earlier turns of the conversation are context; the student's latest message is what to answer.`

const MODE: Record<ChatMode, string> = {
  chat: 'Answer the question.',
  explain_simple:
    'Explain the current page in simple words for someone seeing it for the first time: the main idea, why it matters, and one everyday analogy. Define every symbol you use.',
  explain_exam:
    'Write a model exam answer covering the current page: the definitions, key formulas with symbol meanings and units, and the reasoning an examiner expects, in the order you would write it in an exam.',
  worked_example:
    'Make up one realistic exam-style calculation based on the current page and solve it step by step, showing every substitution with units. End with a one-line takeaway.'
}

export function buildChatUser(input: {
  mode: ChatMode
  question: string
  history: readonly ChatTurn[]
  pages: readonly ChatContextPage[]
  hasFocus: boolean
  language: string
}): string {
  const pages = input.pages.map((p) =>
    [
      `[p. ${p.page}]`,
      p.summary ? `Summary: ${p.summary}` : '',
      p.keyPoints.length > 0 ? `Key points: ${p.keyPoints.join('; ')}` : '',
      p.formulas.length > 0 ? `Formulas: ${p.formulas.map((f) => `$${f}$`).join(', ')}` : '',
      p.text.trim() ? `Text: ${p.text.trim().slice(0, 2500)}` : '(image-only page)'
    ]
      .filter(Boolean)
      .join('\n')
  )
  const history = input.history.slice(-10).map((t) => `${t.role === 'user' ? 'Student' : 'Tutor'}: ${t.text}`)
  return [
    MODE[input.mode],
    input.hasFocus ? 'The attached PDF page is the page the student is reading now.' : '',
    languageInstruction(input.language),
    tagged('pages', pages.join('\n\n') || '(no pages found)'),
    history.length > 0 ? tagged('conversation', history.join('\n\n')) : '',
    tagged('question', input.question.trim() || MODE[input.mode])
  ]
    .filter(Boolean)
    .join('\n\n')
}

/** Distinct cited pages in order of first appearance. */
export function citedPages(text: string): number[] {
  const seen = new Set<number>()
  for (const m of text.matchAll(/\[p\.\s*(\d+)\]/g)) seen.add(Number(m[1]))
  return [...seen]
}
