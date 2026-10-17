import type { TopicMapOutput } from '@shared/ai/schemas'
import type { TopicDraft } from '../types'
import { clamp, cleanStrings } from './text'

/**
 * Post-processing of the topic map. The planner trusts these numbers (weights feed the expected
 * score, minutes feed the time budget), so every invariant it relies on is enforced here rather
 * than hoped for from the model:
 *  - unique keys, parents that exist and do not form cycles;
 *  - page ranges inside the document with start <= end, topics ordered by page;
 *  - difficulty 1..5, core fraction 0..1, minutes >= 0 with core <= full;
 *  - leaf exam weights sum to 1 and a parent weighs the sum of its leaves, so the planner can
 *    use either level without double counting;
 *  - prerequisites point at known, non-nested topics and form a DAG.
 */

type RawTopic = TopicMapOutput['topics'][number]

export const TOPIC_LIMITS = { objectives: 6, reasons: 4 } as const

interface Working extends TopicDraft {
  index: number
  rawPrereqs: string[]
}

function uniqueKeys(raw: readonly RawTopic[]): { keys: string[]; alias: Map<string, string> } {
  const used = new Set<string>()
  const alias = new Map<string, string>()
  const keys = raw.map((t, i) => {
    const base = t.key.trim() === '' ? `topic-${i + 1}` : t.key.trim()
    let key = base
    for (let n = 2; used.has(key); n++) key = `${base}-${n}`
    used.add(key)
    if (!alias.has(base)) alias.set(base, key)
    return key
  })
  return { keys, alias }
}

function ancestors(key: string, parentOf: ReadonlyMap<string, string | null>): string[] {
  const out: string[] = []
  const seen = new Set<string>([key])
  let current = parentOf.get(key) ?? null
  while (current !== null && !seen.has(current)) {
    out.push(current)
    seen.add(current)
    current = parentOf.get(current) ?? null
  }
  return out
}

/** Parent links that would loop back to the topic itself are cut. */
function resolveParents(topics: Working[], alias: ReadonlyMap<string, string>): void {
  const parentOf = new Map<string, string | null>()
  for (const t of topics) {
    const target = t.parentKey === null ? null : (alias.get(t.parentKey.trim()) ?? null)
    parentOf.set(t.key, target === t.key ? null : target)
  }
  for (const t of topics) {
    let current = parentOf.get(t.key) ?? null
    const seen = new Set<string>([t.key])
    while (current !== null) {
      if (seen.has(current)) {
        parentOf.set(t.key, null)
        break
      }
      seen.add(current)
      current = parentOf.get(current) ?? null
    }
  }
  for (const t of topics) t.parentKey = parentOf.get(t.key) ?? null
}

function normalizeWeights(topics: Working[]): void {
  const children = new Map<string, Working[]>()
  for (const t of topics) {
    if (t.parentKey === null) continue
    children.set(t.parentKey, [...(children.get(t.parentKey) ?? []), t])
  }
  const leaves = topics.filter((t) => !children.has(t.key))
  const raw = leaves.map((t) => (Number.isFinite(t.examWeight) && t.examWeight > 0 ? t.examWeight : 0))
  const rawSum = raw.reduce((a, b) => a + b, 0)
  // No usable weights at all: fall back to page share, the most neutral evidence available.
  const basis = rawSum > 0 ? raw : leaves.map((t) => t.pageEnd - t.pageStart + 1)
  const sum = basis.reduce((a, b) => a + b, 0)
  leaves.forEach((t, i) => (t.examWeight = sum > 0 ? (basis[i] ?? 0) / sum : 0))

  const weightOf = (t: Working, seen: Set<string>): number => {
    const kids = children.get(t.key)
    if (!kids || seen.has(t.key)) return t.examWeight
    seen.add(t.key)
    t.examWeight = kids.reduce((acc, kid) => acc + weightOf(kid, seen), 0)
    return t.examWeight
  }
  const seen = new Set<string>()
  for (const t of topics) weightOf(t, seen)
}

/** Adds prerequisite edges in topic order, skipping any edge that would close a cycle. */
function resolvePrerequisites(topics: Working[], alias: ReadonlyMap<string, string>): void {
  const parentOf = new Map(topics.map((t) => [t.key, t.parentKey]))
  const edges = new Map<string, Set<string>>(topics.map((t) => [t.key, new Set<string>()]))
  const reaches = (from: string, to: string): boolean => {
    const stack = [from]
    const seen = new Set<string>()
    while (stack.length > 0) {
      const node = stack.pop() ?? ''
      if (node === to) return true
      if (seen.has(node)) continue
      seen.add(node)
      for (const next of edges.get(node) ?? []) stack.push(next)
    }
    return false
  }
  for (const t of topics) {
    const nested = new Set(ancestors(t.key, parentOf))
    for (const rawKey of t.rawPrereqs) {
      const target = alias.get(rawKey.trim())
      if (target === undefined || target === t.key || nested.has(target)) continue
      if (ancestors(target, parentOf).includes(t.key)) continue
      if (reaches(target, t.key)) continue
      edges.get(t.key)?.add(target)
    }
    t.prerequisiteKeys = [...(edges.get(t.key) ?? [])]
  }
}

/** Applies every invariant listed in the module comment; see there. */
export function normalizeTopics(
  raw: readonly RawTopic[],
  doc: { firstPage: number; lastPage: number }
): TopicDraft[] {
  const { keys, alias } = uniqueKeys(raw)
  const topics: Working[] = raw.map((t, index) => {
    const a = Math.round(clamp(t.page_start, doc.firstPage, doc.lastPage, doc.firstPage))
    const b = Math.round(clamp(t.page_end, doc.firstPage, doc.lastPage, a))
    const core = clamp(t.core_minutes, 0, Number.MAX_SAFE_INTEGER, 0)
    const full = clamp(t.full_minutes, 0, Number.MAX_SAFE_INTEGER, 0)
    return {
      index,
      key: keys[index] ?? `topic-${index + 1}`,
      parentKey: t.parent_key,
      title: t.title.trim() === '' ? `Pages ${Math.min(a, b)}–${Math.max(a, b)}` : t.title.trim(),
      pageStart: Math.min(a, b),
      pageEnd: Math.max(a, b),
      objectives: cleanStrings(t.objectives, TOPIC_LIMITS.objectives),
      difficulty: Math.round(clamp(t.difficulty, 1, 5, 3)),
      examWeight: t.exam_weight,
      examWeightReasons: cleanStrings(t.exam_weight_reasons, TOPIC_LIMITS.reasons),
      coreFraction: clamp(t.core_fraction, 0, 1, 0.5),
      coreMinutes: Math.min(core, full === 0 ? core : full),
      fullMinutes: Math.max(core, full),
      prerequisiteKeys: [],
      rawPrereqs: t.prerequisite_keys
    }
  })

  resolveParents(topics, alias)
  normalizeWeights(topics)
  resolvePrerequisites(topics, alias)

  return topics
    .sort((x, y) => x.pageStart - y.pageStart || y.pageEnd - x.pageEnd || x.index - y.index)
    .map(({ index: _index, rawPrereqs: _raw, ...draft }) => draft)
}
