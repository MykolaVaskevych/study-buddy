import type { ExamProfile, QuestionType } from './domain'

/** "Don't panic" cram sizes: flashcards first, then about one exam question per two cards. */
export const CRAM_SIZES = [
  { cards: 10, label: 'Quick' },
  { cards: 20, label: 'Standard' },
  { cards: 30, label: 'Max' }
] as const

/** Minutes per item for the session estimate: a first look at a card, an answered question. */
const CARD_MINUTES = 0.75
const QUESTION_MINUTES = 1.25

/** About one question per two cards, 5 to 15. */
export const cramQuestionCount = (cards: number): number => Math.min(15, Math.max(5, Math.round(cards / 2)))

/** Session length rounded up to 5 minutes. */
export const cramMinutes = (cards: number, questions: number = cramQuestionCount(cards)): number =>
  Math.max(5, Math.ceil((cards * CARD_MINUTES + questions * QUESTION_MINUTES) / 5) * 5)

/** Question types that look like the exam; numeric ones only when the exam has formulas. */
export function cramQuestionTypes(profile: Pick<ExamProfile, 'formats' | 'formulas'>): QuestionType[] | null {
  const f = profile.formats
  const types: QuestionType[] = []
  if (f.mcq > 0) types.push('mcq', 'multi', 'tf')
  if (f.written > 0) types.push('short')
  if (f.numeric > 0 && profile.formulas !== 'none') types.push('numeric')
  return types.length > 0 ? types : null
}
