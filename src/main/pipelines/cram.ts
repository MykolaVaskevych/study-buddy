import { cramMinutes, cramQuestionCount, cramQuestionTypes } from '@shared/cram'
import type { Card, CardType, Topic, TopicId } from '@shared/domain'
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

/**
 * The `count` active cards worth most in one sitting. Slots go to topics by exam weight ×
 * (1 − mastery), as in a mock exam, and each topic fills them in `cramRank` order. Slots a topic
 * cannot fill go to the best remaining cards anywhere. Returned in book order, so it reads like a story.
 */
export function pickCram(
  cards: readonly Card[],
  topics: readonly Topic[],
  opts: { count: number; skip: ReadonlySet<CardType> }
): Card[] {
  const byId = new Map(topics.map((t) => [t.id, t]))
  const groups = new Map<TopicId | null, Card[]>()
  for (const c of cards) {
    if (c.status !== 'active' || opts.skip.has(c.type)) continue
    const key = c.topicId !== null && byId.has(c.topicId) ? c.topicId : null
    const group = groups.get(key)
    if (group) group.push(c)
    else groups.set(key, [c])
  }
  const known = [...groups.keys()].flatMap((id) => {
    const w = id === null ? undefined : byId.get(id)?.estimates?.examWeight
    return w === undefined ? [] : [w]
  })
  // Cards without a weighted topic count as an average topic.
  const fallback = known.length > 0 ? known.reduce((a, b) => a + b, 0) / known.length : 1
  const entries = [...groups.entries()].map(([id, list]) => {
    const topic = id === null ? undefined : byId.get(id)
    const weight = (topic?.estimates?.examWeight ?? fallback) * (1 - (topic?.mastery ?? 0.5))
    return { list: list.sort(byRank), weight }
  })
  const counts = distribute(
    opts.count,
    entries.map((e) => e.weight)
  )
  const chosen = entries.flatMap((e, i) => e.list.slice(0, counts[i] ?? 0))
  const rest = entries
    .flatMap((e, i) => e.list.slice(counts[i] ?? 0).map((card) => ({ card, weight: e.weight })))
    .sort((a, b) => cramRank(a.card) - cramRank(b.card) || b.weight - a.weight || byRank(a.card, b.card))
    .map((r) => r.card)
  return [...chosen, ...rest.slice(0, Math.max(0, opts.count - chosen.length))].sort(
    (a, b) => firstPage(a) - firstPage(b) || a.id.localeCompare(b.id)
  )
}

export function createCram(deps: Pick<PipelineDeps, 'db'>): { handlers: Pick<Handlers, 'cram.plan'> } {
  const { db } = deps
  return {
    handlers: {
      async 'cram.plan'({ docId, cards: count }) {
        requireDoc(db, docId)
        const profile = resolveExamProfile(db, docId)
        const skip = new Set<CardType>(profile.formulas === 'none' ? ['formula'] : [])
        const cards = pickCram(db.cards.list({ kind: 'document', docId }, false), db.topics.list(docId), {
          count,
          skip
        })
        const questionCount = cramQuestionCount(count)
        return {
          docId,
          cards,
          questionCount,
          questionTypes: cramQuestionTypes(profile),
          minutes: cramMinutes(cards.length, questionCount)
        }
      }
    }
  }
}
