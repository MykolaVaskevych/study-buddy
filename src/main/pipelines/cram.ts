import { cramMinutes, cramQuestionCount, cramQuestionTypes } from '@shared/cram'
import type { Card, CardType, CramScope, DocId, Topic, TopicId } from '@shared/domain'
import { resolveExamProfile } from './exam-profile'
import { requireDoc } from './scope'
import { distribute } from './selection'
import type { Handlers, PipelineDeps } from './types'

/**
 * "Don't panic": a short cram when the exam is close and the deck is too big. The plan needs no AI
 * call: it picks from the cards already made, so it starts instantly.
 */

/** Lower is studied first: what went wrong, what is still shaky, then unseen essentials. */
export function cramRank(card: Card): number {
  if (card.type === 'mistake' || card.srs.lapses > 0) return 0
  if (card.srs.state === 'learning' || card.srs.state === 'relearning') return 1
  return (card.essential ? 2 : 4) + (card.srs.state === 'review' ? 1 : 0)
}

const firstPage = (c: Card): number => Math.min(Number.MAX_SAFE_INTEGER, ...c.sourcePages)

const byRank = (a: Card, b: Card): number =>
  cramRank(a) - cramRank(b) ||
  a.srs.stability - b.srs.stability ||
  firstPage(a) - firstPage(b) ||
  a.id.localeCompare(b.id)

/** Topics in `selected` and every topic below them. */
export function topicsUnder(topics: readonly Topic[], selected: readonly TopicId[]): Set<TopicId> {
  const out = new Set(selected)
  // Parents may come after their children, so repeat until nothing is added (a set, so no cycles).
  for (let grew = true; grew;) {
    grew = false
    for (const t of topics) {
      if (t.parentId !== null && out.has(t.parentId) && !out.has(t.id)) {
        out.add(t.id)
        grew = true
      }
    }
  }
  return out
}

/**
 * The `count` active cards worth most in one sitting, spread over as many topics as possible.
 * Topics are ranked by exam weight × (1 − mastery). First every topic gets its best card, most
 * important topics first. Slots left over go by weight, and slots a topic cannot fill go to the
 * best remaining cards anywhere. The result is interleaved: one card per topic per round, in book
 * order (files in `docOrder`), so two cards from the same topic rarely follow each other.
 */
export function pickCram(
  cards: readonly Card[],
  topics: readonly Topic[],
  opts: { count: number; skip: ReadonlySet<CardType>; docOrder?: readonly DocId[] }
): Card[] {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const groups = new Map<string, Card[]>()
  for (const c of cards) {
    if (c.status !== 'active' || opts.skip.has(c.type)) continue
    // Cards without a known topic are grouped per file.
    const key = c.topicId !== null && byId.has(c.topicId) ? c.topicId : `file:${c.docId}`
    const group = groups.get(key)
    if (group) group.push(c)
    else groups.set(key, [c])
  }
  const known = [...groups.keys()].flatMap((key) => {
    const w = byId.get(key)?.estimates?.examWeight
    return w === undefined ? [] : [w]
  })
  // Cards without a weighted topic count as an average topic.
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1
  const docIndex = (docId: DocId): number => {
    const i = opts.docOrder?.indexOf(docId) ?? -1
    return i < 0 ? (opts.docOrder?.length ?? 0) : i
  }
  const entries = [...groups.entries()].map(([key, list]) => {
    const topic = byId.get(key)
    const sorted = list.sort(byRank)
    const first = sorted.reduce((min, c) => Math.min(min, firstPage(c)), Number.MAX_SAFE_INTEGER)
    return {
      list: sorted,
      weight: (topic?.estimates?.examWeight ?? fallback) * (1 - (topic?.mastery ?? 0.5)),
      // Book position: file order, then the topic's first page.
      position: docIndex(sorted[0]?.docId ?? '') * 1e7 + Math.min(first, 1e7 - 1),
      take: 0
    }
  })
  const count = Math.max(0, opts.count)
  // Coverage first: one card for each topic, the most important topics first.
  const byImportance = [...entries].sort((a, b) => b.weight - a.weight || a.position - b.position)
  for (const e of byImportance.slice(0, count)) e.take = 1
  const covered = Math.min(count, entries.length)
  if (count > covered) {
    const extra = distribute(
      count - covered,
      entries.map((e) => e.weight)
    )
    entries.forEach((e, i) => {
      e.take = Math.min(e.list.length, e.take + (extra[i] ?? 0))
    })
  }
  // Slots a topic could not fill go to the best remaining cards anywhere.
  let spare = count - entries.reduce((sum, e) => sum + e.take, 0)
  const rest = entries
    .flatMap((e) => e.list.slice(e.take).map((card) => ({ card, e })))
    .sort((a, b) => cramRank(a.card) - cramRank(b.card) || b.e.weight - a.e.weight || byRank(a.card, b.card))
  for (const r of rest) {
    if (spare <= 0) break
    r.e.take++
    spare--
  }
  const inBookOrder = [...entries].sort((a, b) => a.position - b.position)
  const out: Card[] = []
  const rounds = Math.max(0, ...entries.map((e) => e.take))
  for (let round = 0; round < rounds; round++) {
    for (const e of inBookOrder) {
      const card = round < e.take ? e.list[round] : undefined
      if (card) out.push(card)
    }
  }
  return out
}

/** One cram scope per file (null topics = the whole file); repeated files are merged. */
export function normaliseScopes(scopes: readonly CramScope[]): CramScope[] {
  const merged = new Map<DocId, TopicId[] | null>()
  for (const s of scopes) {
    const had = merged.get(s.docId)
    if (!merged.has(s.docId)) merged.set(s.docId, s.topicIds === null ? null : [...s.topicIds])
    else if (had !== null && had !== undefined)
      merged.set(s.docId, s.topicIds === null ? null : [...new Set([...had, ...s.topicIds])])
  }
  return [...merged.entries()].map(([docId, topicIds]) => ({ docId, topicIds }))
}

export function createCram(deps: Pick<PipelineDeps, 'db'>): { handlers: Pick<Handlers, 'cram.plan'> } {
  const { db } = deps
  return {
    handlers: {
      async 'cram.plan'({ docId, cards: count, scopes }) {
        requireDoc(db, docId)
        const list = normaliseScopes(scopes ?? [{ docId, topicIds: null }])
        const profile = resolveExamProfile(db, docId)
        const skip = new Set<CardType>(profile.formulas === 'none' ? ['formula'] : [])
        const pool: Card[] = []
        const topics: Topic[] = []
        for (const scope of list) {
          requireDoc(db, scope.docId)
          const docTopics = db.topics.list(scope.docId)
          topics.push(...docTopics)
          const keep = scope.topicIds === null ? null : topicsUnder(docTopics, scope.topicIds)
          for (const c of db.cards.list({ kind: 'document', docId: scope.docId }, false)) {
            if (keep === null || (c.topicId !== null && keep.has(c.topicId))) pool.push(c)
          }
        }
        const cards = pickCram(pool, topics, { count, skip, docOrder: list.map((s) => s.docId) })
        const questionCount = cramQuestionCount(count)
        return {
          docId,
          scopes: list,
          cards,
          questionCount,
          questionTypes: cramQuestionTypes(profile),
          minutes: cramMinutes(cards.length, questionCount)
        }
      }
    }
  }
}
