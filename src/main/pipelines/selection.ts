import type {
  AttemptResult,
  IsoDate,
  PageNotes,
  Question,
  QuestionId,
  QuestionType,
  TopicId
} from '@shared/domain'
import { DAY_MS } from './dates'

/**
 * Pure selection rules: how many items to ask for, which stored questions to reuse, how mock exams
 * spread over topics, and what a quiz result points back to. No I/O, unit-tested in isolation.
 */

/** Questions answered longer ago than this are fresh again (worth asking once more). */
export const FRESH_AFTER_DAYS = 7

/** Splits `total` into integers proportional to `weights` (largest remainder). Zero weights share equally. */
export function distribute(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return []
  const n = Math.max(0, Math.floor(total))
  const clean = weights.map((w) => (Number.isFinite(w) && w > 0 ? w : 0))
  const sum = clean.reduce((a, b) => a + b, 0)
  const shares = sum > 0 ? clean.map((w) => (w / sum) * n) : clean.map(() => n / clean.length)
  const out = shares.map(Math.floor)
  let left = n - out.reduce((a, b) => a + b, 0)
  const byRemainder = shares
    .map((s, i) => ({ i, r: s - Math.floor(s) }))
    .sort((a, b) => b.r - a.r || a.i - b.i)
  for (const { i } of byRemainder) {
    if (left <= 0) break
    out[i] = (out[i] ?? 0) + 1
    left--
  }
  return out
}

/**
 * Default flashcard count for a window: 5 for one page, growing with size, 15-25 for topic-sized
 * ranges. Essentials-only decks are smaller (~60 %).
 */
export function defaultCardCount(pages: number, essentialsOnly: boolean): number {
  const full = pages <= 1 ? 5 : pages < 5 ? 5 + 3 * (pages - 1) : Math.min(25, Math.max(15, 10 + pages))
  return essentialsOnly ? Math.max(3, Math.round(full * 0.6)) : full
}

export function isFresh(lastAnswered: IsoDate | undefined, now: Date): boolean {
  if (lastAnswered === undefined) return true
  return now.getTime() - Date.parse(lastAnswered) > FRESH_AFTER_DAYS * DAY_MS
}

/**
 * Stored questions worth asking now: never answered first (in stored order), then those answered
 * longest ago, skipping anything answered within FRESH_AFTER_DAYS.
 */
export function pickFresh(
  questions: readonly Question[],
  lastAnswered: ReadonlyMap<QuestionId, IsoDate>,
  now: Date,
  opts: { limit: number; types?: readonly QuestionType[] | null; exclude?: ReadonlySet<QuestionId> }
): Question[] {
  const types = opts.types && opts.types.length > 0 ? new Set(opts.types) : null
  const candidates = questions.filter(
    (q) =>
      q.status === 'active' &&
      !opts.exclude?.has(q.id) &&
      (types === null || types.has(q.type)) &&
      isFresh(lastAnswered.get(q.id), now)
  )
  const never = candidates.filter((q) => !lastAnswered.has(q.id))
  const old = candidates
    .filter((q) => lastAnswered.has(q.id))
    .sort((a, b) => (lastAnswered.get(a.id) ?? '').localeCompare(lastAnswered.get(b.id) ?? ''))
  return [...never, ...old].slice(0, Math.max(0, opts.limit))
}

/**
 * Mock exam spread: questions per topic proportional to exam weight × (1 − mastery). Unknown
 * mastery counts as 0.5. Mastered, low-weight topics get few or none.
 */
export function mockAllocation(
  topics: readonly { id: TopicId; weight: number; mastery: number | null }[],
  count: number
): Map<TopicId, number> {
  const weights = topics.map((t) => Math.max(0, t.weight) * (1 - (t.mastery ?? 0.5)))
  const counts = distribute(count, weights)
  return new Map(topics.map((t, i) => [t.id, counts[i] ?? 0]))
}

/** Splits a book answer into gradable points: lines, bullets or sentences; at most five. */
export function rubricFromAnswer(answer: string): string[] {
  const points = answer
    .split(/\n+|(?<=[.!?;])\s+(?=[A-Z0-9(])/)
    .map((p) => p.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, '').trim())
    .filter((p) => p.length > 1)
  return points.length > 0 ? points.slice(0, 5) : [answer.trim()]
}

/** Pages to re-read after a quiz: source pages of wrong answers, most often cited first, then in page order. */
export function reviewPages(
  attempts: readonly AttemptResult[],
  questions: ReadonlyMap<QuestionId, Question>
): number[] {
  const counts = new Map<number, number>()
  for (const a of attempts) {
    if (a.correct) continue
    for (const page of questions.get(a.questionId)?.sourcePages ?? [])
      counts.set(page, (counts.get(page) ?? 0) + 1)
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([page]) => page)
}

const CONTINUED =
  /\b(?:cont(?:'d|\.|inued)?|continuation|fortsetzung|forts\.)(?=\W|$)|\(\s*\d+\s*\/\s*\d+\s*\)/i
/** Below this many non-space characters a page rarely stands on its own (image slide, a few bullets). */
const THIN_PAGE_CHARS = 150

const firstLine = (text: string): string => (text.split('\n')[0] ?? '').trim().toLowerCase()

/**
 * Whether a page continues the previous one, so a page check should cover both. Signals: the same
 * slide title, a "(cont.)" / "(2/3)" marker, an answers page right after exercises, or a page too
 * thin to test on its own. Only within one topic and after a teachable page.
 */
export function isContinuation(input: {
  prev: PageNotes | null
  cur: PageNotes | null
  prevText: string
  curText: string
  sameTopic: boolean
}): boolean {
  const { prev, cur } = input
  if (!prev?.indexed || !prev.teachable || !input.sameTopic) return false
  if (prev.kind !== 'content' && prev.kind !== 'exercise') return false
  if (prev.kind === 'exercise' && cur?.kind === 'answers') return true
  const head = firstLine(input.curText)
  if (head !== '' && head === firstLine(input.prevText)) return true
  if (CONTINUED.test(head)) return true
  return input.curText.replace(/\s/g, '').length < THIN_PAGE_CHARS
}
