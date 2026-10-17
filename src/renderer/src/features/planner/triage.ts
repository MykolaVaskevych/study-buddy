import { levelOptions, normaliseWeights } from '@shared/planner'
import type { PlanInput, PlanItem, PlanResult, PlanTopic, StudyLevel } from '@shared/planner'
import type { Topic } from '@shared/domain'

/**
 * Rows of the triage table: the solver's decision per topic, joined with what the screen needs to
 * explain it (pages, chapter, difficulty, the weight the student can override, and the trade-off).
 */

export type SortKey = 'value' | 'weight' | 'time' | 'page'

export interface TriageRow {
  id: string
  title: string
  /** Parent topic in the course map; topics without one stand alone. */
  chapter: { id: string; title: string } | null
  pageStart: number | null
  pageEnd: number | null
  /** Position in the book: course-map order, else the order plan.topics came in. */
  order: number
  /** 1 (easy) .. 5 (hard), null when not estimated. */
  difficulty: number | null
  item: PlanItem
  /** Exam weight in use, 0..1 before normalising: the student's override or the AI estimate. */
  weight: number
  /** The AI's estimate, 0..1. */
  estimatedWeight: number
  weightOverridden: boolean
  pin: StudyLevel | null
  /** Most marks gained per minute over skipping, at core or full. Infinity when a level is free. */
  density: number
  /** What studying it in full would take and add over skipping: the honest price of a skip. */
  fullMinutes: number
  fullGain: number
  /** Titles of studied topics that build on this one. */
  requiredBy: string[]
}

/** Builds one row per planned topic, in plan.topics order. */
export function buildRows(
  planTopics: readonly PlanTopic[],
  topics: readonly Topic[],
  input: PlanInput,
  result: PlanResult
): TriageRow[] {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const items = new Map(result.items.map((i) => [i.topicId, i]))
  const { weights } = normaliseWeights([...planTopics], input)
  const pins = new Map<string, StudyLevel>()
  const overrides = new Map<string, number>()
  for (const o of input.overrides) {
    if (o.level !== undefined) pins.set(o.topicId, o.level)
    if (o.examWeight !== undefined) overrides.set(o.topicId, o.examWeight)
  }
  const requiredBy = new Map<string, string[]>()
  for (const t of planTopics) {
    if ((items.get(t.id)?.level ?? 'skip') === 'skip') continue
    for (const p of new Set(t.prerequisites)) {
      if (p !== t.id) requiredBy.set(p, [...(requiredBy.get(p) ?? []), t.title])
    }
  }

  return planTopics.flatMap((t, index): TriageRow[] => {
    const item = items.get(t.id)
    if (!item) return []
    const topic = byId.get(t.id)
    const parent = topic?.parentId ? byId.get(topic.parentId) : undefined
    const options = levelOptions(t, weights[index] ?? 0, input.format)
    const gain = (level: 'core' | 'full'): number => options[level].expectedMarks - options.skip.expectedMarks
    const density = (level: 'core' | 'full'): number => {
      const minutes = options[level].minutes
      if (minutes > 0) return gain(level) / minutes
      return gain(level) > 0 ? Infinity : 0
    }
    const override = overrides.get(t.id)
    return [
      {
        id: t.id,
        title: t.title,
        chapter: parent ? { id: parent.id, title: parent.title } : null,
        pageStart: topic?.pageStart ?? null,
        pageEnd: topic?.pageEnd ?? null,
        order: topic?.order ?? planTopics.length + index,
        difficulty: topic?.estimates?.difficulty ?? null,
        item,
        weight: override ?? t.examWeight,
        estimatedWeight: t.examWeight,
        weightOverridden: override !== undefined,
        pin: pins.get(t.id) ?? null,
        density: Math.max(density('core'), density('full')),
        fullMinutes: options.full.minutes,
        fullGain: gain('full'),
        requiredBy: requiredBy.get(t.id) ?? []
      }
    ]
  })
}

/** Minutes a row stands for: planned time, or for a skipped topic what full study would take. */
export const rowMinutes = (row: TriageRow): number =>
  row.item.level === 'skip' ? row.fullMinutes : row.item.minutes

const byOrder = (a: TriageRow, b: TriageRow): number => a.order - b.order

const comparators: Record<SortKey, (a: TriageRow, b: TriageRow) => number> = {
  value: (a, b) => (a.density === b.density ? 0 : b.density > a.density ? 1 : -1) || byOrder(a, b),
  weight: (a, b) => b.weight - a.weight || byOrder(a, b),
  time: (a, b) => rowMinutes(b) - rowMinutes(a) || byOrder(a, b),
  page: byOrder
}

/** Rows in display order. "value" puts the most marks per minute first. Stable: ties keep book order. */
export function sortRows(rows: readonly TriageRow[], key: SortKey): TriageRow[] {
  return [...rows].sort(comparators[key])
}

export interface RowGroup {
  /** Stable React key: re-sorting must never remount rows (it would drop keyboard focus). */
  key: string
  /** Null for topics outside any chapter (and for the whole list when not grouping). */
  chapter: TriageRow['chapter']
  rows: TriageRow[]
}

/**
 * Groups sorted rows by chapter. Groups follow the book (by their first topic's position), and each
 * group keeps the sort order inside it. Topics without a chapter form their own headerless group.
 */
export function groupRows(rows: readonly TriageRow[], byChapter: boolean): RowGroup[] {
  if (!byChapter) return rows.length > 0 ? [{ key: 'all', chapter: null, rows: [...rows] }] : []
  const groups = new Map<string, RowGroup & { first: number }>()
  for (const row of rows) {
    const key = row.chapter ? `chapter:${row.chapter.id}` : `topic:${row.id}`
    const g = groups.get(key)
    if (g) {
      g.rows.push(row)
      g.first = Math.min(g.first, row.order)
    } else groups.set(key, { key, chapter: row.chapter, rows: [row], first: row.order })
  }
  return [...groups.values()]
    .sort((a, b) => a.first - b.first)
    .map(({ key, chapter, rows: r }) => ({ key, chapter, rows: r }))
}

/** True when any row sits in a chapter, i.e. grouping would change anything. */
export const hasChapters = (rows: readonly TriageRow[]): boolean => rows.some((r) => r.chapter !== null)

export interface SkipSummary {
  count: number
  /** Minutes full study of every skipped topic would take. */
  minutes: number
  /** Share of marks full study of them would add over skipping. */
  gain: number
}

/** What the skipped topics are trading away. */
export function skipSummary(rows: readonly TriageRow[]): SkipSummary {
  const skipped = rows.filter((r) => r.item.level === 'skip')
  return {
    count: skipped.length,
    minutes: skipped.reduce((s, r) => s + r.fullMinutes, 0),
    gain: skipped.reduce((s, r) => s + Math.max(0, r.fullGain), 0)
  }
}

const SEP_PAIR = '\u0001'
const SEP_ITEM = '\u0002'

/** A compact fingerprint of the level per topic, cheap to compare between renders. */
export const levelKey = (items: readonly PlanItem[]): string =>
  items.map((i) => `${i.topicId}${SEP_PAIR}${i.level}`).join(SEP_ITEM)

/** Topic ids whose level differs between two level keys (new topics count as changed). */
export function changedLevels(before: string, after: string): Set<string> {
  const parse = (key: string): Map<string, string> =>
    new Map(
      key
        .split(SEP_ITEM)
        .filter(Boolean)
        .map((pair) => {
          const [id = '', level = ''] = pair.split(SEP_PAIR)
          return [id, level]
        })
    )
  const old = parse(before)
  const changed = new Set<string>()
  if (before === '') return changed
  for (const [id, level] of parse(after)) if (old.get(id) !== level) changed.add(id)
  return changed
}
