import type {
  LessonOutput,
  CardsOutput,
  NamingOutput,
  GradeOutput,
  IndexChunkOutput,
  QuestionsOutput,
  TopicMapOutput,
  VerifyOutput
} from '@shared/ai/schemas'
import type { QuestionType } from '@shared/domain'
import { FOCUS_PAGES_KEY, PAGE_LABEL_PATTERN, parseHeader, parseRange } from '../../prompts/common'
import { readTagged } from '../../prompts/grade'
import { parseManifest } from '../../prompts/manifest'
import { parseBlindQuestions } from '../../prompts/verify'
import { tokens } from '../../quality/text'
import { FALSE_STATEMENT_PREFIX, TF_PREFIX, hash, mcqKey, multiKey, numericKey, tfKey } from './keys'

/**
 * Deterministic, offline stand-ins for model output, derived only from the prompt text the
 * StudyAi prompts write (header lines, page manifest, index notes, tagged sections). Page
 * numbers always come from the prompt, so they fall inside the requested range, and quotes are
 * copied from page text the prompt carried, so grounding checks pass as with a good model.
 */

interface NotePage {
  page: number
  summary: string
  term: string
}

function firstWords(text: string, n: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, n).join(' ')
}

function shorten(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max).trimEnd()}…`
}

function focusRange(text: string): { from: number; to: number } | null {
  return parseRange(parseHeader(text).get(FOCUS_PAGES_KEY))
}

function countOf(text: string, fallback: number): number {
  const n = Number(parseHeader(text).get('Count'))
  return Number.isInteger(n) && n > 0 ? n : fallback
}

/** Reads the notes blocks written by prompts/notes.ts. */
export function parseNotes(text: string): NotePage[] {
  const out: NotePage[] = []
  const header = new RegExp(`^${PAGE_LABEL_PATTERN} \\[`)
  // Notes blocks are separated by blank lines (see prompts/notes.ts) and start with the page label.
  for (const block of text.split('\n\n')) {
    const match = header.exec(block.trimStart())
    if (!match?.[1]) continue
    const summary = /^Summary: (.*)$/m.exec(block)?.[1]?.trim() ?? ''
    const concept = /^Concepts: (.*?) \(/m.exec(block)?.[1]?.trim()
    out.push({ page: Number(match[1]), summary, term: concept ?? firstWords(summary, 3) })
  }
  return out
}

/** Notes inside the focus range, else one placeholder per focus page. */
function sourcePages(text: string): NotePage[] {
  const range = focusRange(text)
  const notes = parseNotes(text).filter((n) => range === null || (n.page >= range.from && n.page <= range.to))
  if (notes.length > 0) return notes
  const pages: NotePage[] = []
  for (let p = range?.from ?? 1; p <= (range?.to ?? 1); p++)
    pages.push({ page: p, summary: `Content of page ${p}.`, term: `page ${p}` })
  return pages
}

export function fakeIndex(text: string): IndexChunkOutput {
  let entries = parseManifest(text)
  if (entries.length === 0) {
    const range = focusRange(text) ?? { from: 1, to: 1 }
    entries = Array.from({ length: range.to - range.from + 1 }, (_, i) => ({
      page: range.from + i,
      imageOnly: true,
      snippet: null
    }))
  }
  return {
    language: 'en',
    pages: entries.map((e) => {
      const snippet = e.snippet ?? ''
      if (e.imageOnly || snippet === '')
        return {
          page: e.page,
          kind: 'content',
          teachable: true,
          summary: `Diagram on page ${e.page} (image-only slide).`,
          key_points: [],
          concepts: [],
          formulas: [],
          exercises: [],
          exam_signals: []
        }
      const isTitle = e.page === 1
      const formula = /([A-Za-z_]+\s*=\s*[^.]+)/.exec(snippet)?.[1]
      return {
        page: e.page,
        kind: isTitle ? 'title' : snippet.includes('?') ? 'exercise' : 'content',
        teachable: !isTitle,
        summary: snippet,
        key_points: [snippet],
        concepts: [{ term: firstWords(snippet, 3), definition: snippet, importance: 'core' }],
        formulas:
          formula === undefined
            ? []
            : [
                {
                  latex: formula.trim(),
                  meaning: `Relation stated on page ${e.page}.`,
                  symbols: [],
                  importance: 'core'
                }
              ],
        exercises: snippet.includes('?') ? [{ question: snippet, answer: null }] : [],
        exam_signals: /try it|exercise/i.test(snippet) ? ['worked_example'] : []
      }
    })
  }
}

export function fakeTopics(text: string): TopicMapOutput {
  const digests = [...text.matchAll(/^p(\d+) \[(\w+)\][^|]*\| ([^|\n]*)/gm)].map((m) => ({
    page: Number(m[1]),
    summary: (m[3] ?? '').trim()
  }))
  const docRange = parseRange(parseHeader(text).get('Document pages')) ?? { from: 1, to: 1 }
  const pages = digests.length > 0 ? digests : [{ page: docRange.from, summary: 'Document' }]
  const groups: (typeof pages)[] = []
  for (let i = 0; i < pages.length; i += 5) groups.push(pages.slice(i, i + 5))
  return {
    topics: groups.map((group, i) => {
      const first = group[0] ?? { page: docRange.from, summary: '' }
      const last = group[group.length - 1] ?? first
      const title = firstWords(first.summary, 4) || `Pages ${first.page}-${last.page}`
      return {
        key: `topic-${i + 1}`,
        parent_key: null,
        title,
        page_start: first.page,
        page_end: last.page,
        objectives: [`Explain ${title}`],
        difficulty: 2 + (i % 3),
        exam_weight: group.length,
        exam_weight_reasons: [`Covers ${group.length} pages`],
        core_fraction: 0.6,
        core_minutes: 4 * group.length,
        full_minutes: 8 * group.length,
        prerequisite_keys: i > 0 ? [`topic-${i}`] : []
      }
    })
  }
}

export function fakeCards(text: string): CardsOutput {
  const essentials = parseHeader(text).get('Scope') === 'essentials'
  const pages = sourcePages(text)
  const count = countOf(text, pages.length)
  return {
    cards: pages.slice(0, count).map((p, i) => ({
      type: 'basic',
      front: `What does page ${p.page} say about ${p.term}?`,
      back: p.summary,
      essential: essentials || i % 2 === 0,
      source_pages: [p.page],
      evidence: p.summary
    }))
  }
}

type RawQuestion = QuestionsOutput['questions'][number]

const EMPTY_ANSWER = {
  options: null,
  correct_index: null,
  correct_indices: null,
  tf_answer: null,
  model_answer: null,
  rubric: null,
  numeric_value: null,
  numeric_tolerance: null,
  numeric_unit: null,
  option_rationales: null
} as const

function withCorrectAt(correct: string[], distractors: string[], keys: number[]): string[] {
  const options = [...distractors]
  keys.forEach((k, i) => options.splice(k, 0, correct[i] ?? ''))
  return options
}

function fakeQuestion(p: NotePage, type: QuestionType, i: number): RawQuestion {
  const base = {
    ...EMPTY_ANSWER,
    explanation: `Page ${p.page} states: ${shorten(p.summary, 120)}`,
    difficulty: 2,
    source_pages: [p.page],
    evidence: p.summary
  }
  const summary = shorten(p.summary, 90)
  switch (type) {
    case 'mcq': {
      const stem = `Which statement matches what page ${p.page} says about ${p.term}?`
      const k = mcqKey(stem, 4)
      const options = withCorrectAt(
        [summary],
        [
          `${p.term} plays no role in the material on page ${p.page}.`,
          `Page ${p.page} only lists organisational details.`,
          `Page ${p.page} argues the opposite of the usual definition.`
        ],
        [k]
      )
      return {
        ...base,
        type,
        stem,
        options,
        correct_index: k,
        option_rationales: options.map(() => 'See page.')
      }
    }
    case 'multi': {
      const stem = `Which statements about ${p.term} are supported by page ${p.page}? Select all that apply.`
      const keys = multiKey(stem, 4)
      const options = withCorrectAt(
        [summary, `${p.term} is discussed on page ${p.page}.`],
        [`Page ${p.page} never mentions ${p.term}.`, `${p.term} is defined only in the appendix.`],
        keys
      )
      return { ...base, type, stem, options, correct_indices: keys, option_rationales: null }
    }
    case 'tf': {
      const truthy = hash(`${p.page}:${i}`) % 2 === 0
      const stem = truthy ? `${TF_PREFIX}${summary}` : `${FALSE_STATEMENT_PREFIX}${summary}`
      return { ...base, type, stem, tf_answer: truthy }
    }
    case 'short':
      return {
        ...base,
        type,
        stem: `Explain in your own words what page ${p.page} says about ${p.term}.`,
        model_answer: p.summary,
        rubric: [`Mentions ${p.term}`, `States: ${summary}`]
      }
    case 'numeric': {
      const a = p.page + 2
      const b = i + 3
      return {
        ...base,
        type,
        stem: `For the example on page ${p.page} (${p.term}), compute $${a} \\times ${b}$.`,
        numeric_value: a * b,
        numeric_tolerance: 0,
        numeric_unit: null
      }
    }
  }
}

const QUESTION_TYPES: readonly QuestionType[] = ['mcq', 'multi', 'tf', 'short', 'numeric']

export function fakeQuestions(text: string): QuestionsOutput {
  const header = parseHeader(text)
  const types = (header.get('Types') ?? '')
    .split(',')
    .map((t) => QUESTION_TYPES.find((known) => known === t.trim()))
    .filter((t): t is QuestionType => t !== undefined)
  const allowed = types.length > 0 ? types : QUESTION_TYPES
  const pages = sourcePages(text)
  const count = countOf(text, pages.length)
  const questions: RawQuestion[] = []
  for (let i = 0; i < count; i++) {
    const page = pages[i % pages.length]
    const type = allowed[i % allowed.length]
    if (page !== undefined && type !== undefined) questions.push(fakeQuestion(page, type, i))
  }
  return { questions }
}

export function fakeVerify(text: string): VerifyOutput {
  return {
    answers: parseBlindQuestions(text).map((q) => {
      const n = q.options?.length ?? 0
      const answer = {
        id: q.id,
        choice_index: q.type === 'mcq' && n > 0 ? mcqKey(q.stem, n) : null,
        choice_indices: q.type === 'multi' && n > 0 ? multiKey(q.stem, n) : null,
        tf_answer: q.type === 'tf' ? tfKey(q.stem) : null,
        numeric_value: q.type === 'numeric' ? numericKey(q.stem) : null
      }
      const answerable =
        q.type === 'short' ||
        answer.choice_index !== null ||
        answer.choice_indices !== null ||
        answer.tf_answer !== null ||
        answer.numeric_value !== null
      return { ...answer, answerable }
    })
  }
}

export function fakeGrade(text: string): GradeOutput {
  const expected = new Set(tokens(readTagged(text, 'model_answer') ?? ''))
  const given = new Set(tokens(readTagged(text, 'student_response') ?? ''))
  const hit = [...expected].filter((t) => given.has(t)).length
  const score = expected.size === 0 ? 0 : hit / expected.size
  const rubric = (readTagged(text, 'rubric') ?? '')
    .split('\n')
    .map((line) => line.replace(/^- /, '').trim())
    .filter((line) => line !== '' && !line.startsWith('('))
  const missing = rubric.filter((point) => {
    const words = tokens(point)
    return words.length > 0 && words.filter((w) => given.has(w)).length / words.length < 0.5
  })
  return {
    score,
    verdict: score >= 0.8 ? 'correct' : score <= 0.2 ? 'incorrect' : 'partial',
    feedback: `Matched ${hit} of ${expected.size} key words of the model answer.`,
    missing_points: missing
  }
}

/** A short chapter built from the focus pages' notes, with page citations. */
export function fakeLesson(text: string): LessonOutput {
  const pages = sourcePages(text)
  const cite = (p: NotePage): string => `[p. ${p.page}]`
  return {
    sections: [
      {
        title: 'The idea',
        markdown: pages.map((p) => `${p.summary} ${cite(p)}`).join('\n\n') || 'Offline fake chapter.'
      },
      {
        title: 'In one minute',
        markdown: pages.map((p) => `- ${p.term} ${cite(p)}`).join('\n') || '- Offline'
      }
    ],
    exercises: pages.slice(0, 2).map((p) => ({ question: `Explain ${p.term}.`, answer: p.summary }))
  }
}

/** Names derived from the current ones, so tests can tell a suggestion from the original. */
export function fakeNaming(text: string): NamingOutput {
  const files = [...text.matchAll(/^\[(\d+)\] current name: (.+)$/gm)].map((m) => ({
    index: Number(m[1]),
    title: `${(m[2] ?? '').trim()} (named)`
  }))
  return { course_name: 'Named Course', files }
}
