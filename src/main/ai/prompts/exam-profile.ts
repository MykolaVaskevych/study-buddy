import type { CardType, ExamProfile, QuestionType } from '@shared/domain'

/**
 * Turns an exam profile into generation guidance, so cards and questions train what this exam
 * actually asks (a conceptual MCQ exam gets reasoning and comparison cards, not formula recall).
 */

export type CardMix = Record<Exclude<CardType, 'mistake'>, number>

/** Target share of each card type (sums to 1) for this exam. */
export function cardMix(p: ExamProfile): CardMix {
  const formula = p.formulas === 'none' ? 0 : p.formulas === 'apply' ? 0.25 : 0.1
  const rest = 1 - formula
  // MCQs reward telling similar ideas apart; written answers reward explaining why.
  const compare = rest * (0.15 + 0.15 * p.formats.mcq)
  const why = rest * (0.25 + 0.15 * p.formats.written)
  const cloze = rest * 0.1
  const basic = Math.max(0, rest - compare - why - cloze)
  return { basic, cloze, why, contrast: compare, formula }
}

const pct = (x: number): string => `${Math.round(x * 100)} %`

/** Card instructions for the prompt. */
export function cardGuidance(p: ExamProfile): string {
  const mix = cardMix(p)
  const lines = [
    `Card mix for this exam: about ${pct(mix.basic + mix.cloze)} concept cards (basic or cloze), ${pct(mix.why)} why cards, ${pct(mix.contrast)} contrast cards${mix.formula > 0 ? `, ${pct(mix.formula)} formula cards` : ''}.`
  ]
  if (p.formulas === 'none')
    lines.push(
      'The exam does not use formulas: make no formula cards. Where a page has a formula, ask about the relationship in words instead (what grows or shrinks when something changes).'
    )
  else if (p.formulas === 'recognise' || p.formulaSheet)
    lines.push(
      `${p.formulaSheet ? 'A formula sheet is provided in the exam: ' : ''}never ask to reproduce a formula from memory. Formula cards ask what a formula means, when it applies, or how the result changes when a quantity changes.`
    )
  else lines.push('The exam has calculations: formula cards should train applying the formula, with units.')
  return lines.join('\n')
}

/** Question types allowed for this exam, most frequent first. */
export function questionTypesFor(p: ExamProfile): QuestionType[] {
  const types: QuestionType[] = []
  if (p.formats.mcq >= 0.1) types.push('mcq', 'multi', 'tf')
  if (p.formats.written >= 0.1) types.push('short')
  if (p.formats.numeric >= 0.1 && p.formulas === 'apply') types.push('numeric')
  return types.length > 0 ? types : ['mcq', 'multi', 'tf', 'short', 'numeric']
}

/** Question instructions for the prompt: format mix, style and real examples to imitate. */
export function questionGuidance(p: ExamProfile): string {
  const lines = [
    `The real exam is about ${pct(p.formats.mcq)} multiple choice, ${pct(p.formats.written)} written and ${pct(p.formats.numeric)} calculation. Match that mix.`
  ]
  if (p.formulas === 'none')
    lines.push('The exam asks no formulas or calculations: test understanding in words.')
  if (p.style.trim()) lines.push(`Exam style: ${p.style.trim()}`)
  if (p.examples.length > 0)
    lines.push(
      'Questions from a real past paper, to imitate in style and difficulty (never copy them):',
      ...p.examples.slice(0, 5).map((e) => `- ${e.replace(/\s+/g, ' ').trim()}`)
    )
  return lines.join('\n')
}

/** One line for the study book: what to emphasise for this exam. */
export function lessonGuidance(p: ExamProfile): string {
  if (p.formulas === 'none')
    return 'This exam is conceptual with no calculations: keep formulas brief, explain relationships in words, and make the worked example and exercises reasoning questions like the exam.'
  if (p.formulas === 'recognise' || p.formulaSheet)
    return 'In this exam students must understand formulas rather than memorise them: explain what each formula means and when it applies.'
  return 'This exam has calculations: make the worked example and exercises numeric, with units.'
}

/** Profile used before the student or a past paper says anything. */
export function defaultProfile(
  docId: string,
  format: 'mcq' | 'written' | 'numeric' | 'mixed' | null
): ExamProfile {
  const formats =
    format === 'mcq'
      ? { mcq: 1, written: 0, numeric: 0 }
      : format === 'written'
        ? { mcq: 0, written: 1, numeric: 0 }
        : format === 'numeric'
          ? { mcq: 0, written: 0, numeric: 1 }
          : { mcq: 0.4, written: 0.3, numeric: 0.3 }
  return {
    docId,
    formats,
    formulas: format === 'mcq' ? 'recognise' : 'apply',
    formulaSheet: false,
    style: '',
    examples: [],
    source: 'default',
    updatedAt: null
  }
}
