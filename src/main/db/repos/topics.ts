import { and, asc, between, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { DocId, Topic, TopicId } from '@shared/domain'
import type { MasteryBelief } from '@shared/planner/types'
import { NotFoundError, type RepoContext } from '../context'
import { cards, questions, reading, topics } from '../schema'
import type { NewTopic, TopicRepo } from '../types'

type TopicRow = typeof topics.$inferSelect

/** Uninformative prior: no evidence yet means "could be anything", mean 0.5. */
const PRIOR: MasteryBelief = { alpha: 1, beta: 1 }

function belief(row: Pick<TopicRow, 'masteryAlpha' | 'masteryBeta'>): MasteryBelief | null {
  return row.masteryAlpha !== null && row.masteryBeta !== null
    ? { alpha: row.masteryAlpha, beta: row.masteryBeta }
    : null
}

function toTopic(row: TopicRow): Topic {
  const b = belief(row)
  return {
    id: row.id,
    docId: row.docId,
    parentId: row.parentId,
    order: row.order,
    title: row.title,
    pageStart: row.pageStart,
    pageEnd: row.pageEnd,
    objectives: row.objectives,
    estimates: row.estimates,
    mastery: b ? b.alpha / (b.alpha + b.beta) : null
  }
}

const normTitle = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ')

/** Depth in the parent chain; cycle-safe. */
function depthOf(byId: Map<TopicId, TopicRow>, id: TopicId): number {
  const seen = new Set<TopicId>()
  let depth = 0
  for (let cur = byId.get(id); cur?.parentId && !seen.has(cur.id); cur = byId.get(cur.parentId)) {
    seen.add(cur.id)
    depth++
  }
  return depth
}

/** Deepest topic containing the page; ties go to the narrower range, then the earlier topic. */
function deepestFor(rows: TopicRow[], page: number): TopicRow | null {
  const byId = new Map(rows.map((r) => [r.id, r]))
  let best: { row: TopicRow; depth: number } | null = null
  for (const row of rows) {
    if (page < row.pageStart || page > row.pageEnd) continue
    const depth = depthOf(byId, row.id)
    const span = row.pageEnd - row.pageStart
    const better =
      !best ||
      depth > best.depth ||
      (depth === best.depth && span < best.row.pageEnd - best.row.pageStart) ||
      (depth === best.depth && span === best.row.pageEnd - best.row.pageStart && row.order < best.row.order)
    if (better) best = { row, depth }
  }
  return best?.row ?? null
}

export function createTopicRepo(ctx: RepoContext): TopicRepo {
  const { db } = ctx

  const rowsOf = (docId: DocId): TopicRow[] =>
    db.select().from(topics).where(eq(topics.docId, docId)).orderBy(asc(topics.order)).all()

  const getRow = (topicId: TopicId): TopicRow | undefined =>
    db.select().from(topics).where(eq(topics.id, topicId)).get()

  /**
   * Points cards/questions of the document that have no topic at the deepest topic containing their
   * first cited page. Runs after a rebuild so items keep showing up in topic scopes.
   */
  const relinkOrphans = (docId: DocId, rows: TopicRow[]): void => {
    for (const table of [cards, questions] as const) {
      const orphans = db
        .select({ id: table.id, sourcePages: table.sourcePages })
        .from(table)
        .where(and(eq(table.docId, docId), isNull(table.topicId)))
        .all()
      for (const item of orphans) {
        const first = Math.min(...item.sourcePages)
        const topic = Number.isFinite(first) ? deepestFor(rows, first) : null
        if (topic) db.update(table).set({ topicId: topic.id }).where(eq(table.id, item.id)).run()
      }
    }
  }

  return {
    replaceAll(docId, newTopics: NewTopic[]) {
      return ctx.tx(() => {
        const old = rowsOf(docId)
        const oldByKey = new Map(old.map((t) => [t.key, t]))
        const oldByTitle = new Map(old.map((t) => [normTitle(t.title), t]))

        // First occurrence of a key wins, so a duplicated key from the model cannot steal references.
        const keyToId = new Map<string, TopicId>()
        const ids = newTopics.map((t) => {
          const id = ctx.newId()
          if (!keyToId.has(t.key)) keyToId.set(t.key, id)
          return id
        })
        const parentKeyOf = new Map(newTopics.map((t) => [t.key, t.parentKey]))

        /** Rejects self-parenting and parent cycles (A -> B -> A) instead of storing a loop. */
        const resolveParent = (t: NewTopic): TopicId | null => {
          if (t.parentKey === null) return null
          const seen = new Set<string>([t.key])
          for (let k: string | null = t.parentKey; k !== null; k = parentKeyOf.get(k) ?? null) {
            if (seen.has(k)) return null
            seen.add(k)
          }
          return keyToId.get(t.parentKey) ?? null
        }

        // "Same" topic across rebuilds (by key, else by title) keeps its mastery and its items.
        const carried = new Map<TopicId, TopicId>()
        newTopics.forEach((t, i) => {
          const id = ids[i]
          if (id === undefined) return
          const match = oldByKey.get(t.key) ?? oldByTitle.get(normTitle(t.title))
          // An old topic carries over to at most one new topic.
          const prev = match && !carried.has(match.id) ? match : undefined
          if (prev) carried.set(prev.id, id)
          db.insert(topics)
            .values({
              id,
              docId,
              parentId: null,
              key: t.key,
              order: i,
              title: t.title,
              pageStart: Math.min(t.pageStart, t.pageEnd),
              pageEnd: Math.max(t.pageStart, t.pageEnd),
              objectives: t.objectives,
              estimates: t.estimates
                ? {
                    ...t.estimates,
                    prerequisites: [
                      ...new Set(
                        t.estimates.prerequisites
                          .map((key) => keyToId.get(key))
                          .filter((pid): pid is TopicId => pid !== undefined && pid !== id)
                      )
                    ]
                  }
                : null,
              masteryAlpha: prev?.masteryAlpha ?? null,
              masteryBeta: prev?.masteryBeta ?? null
            })
            .run()
        })
        // Parents are set in a second pass: a child may be listed before its parent.
        newTopics.forEach((t, i) => {
          const id = ids[i]
          const parentId = resolveParent(t)
          if (id !== undefined && parentId !== null) {
            db.update(topics).set({ parentId }).where(eq(topics.id, id)).run()
          }
        })

        for (const [oldId, newId] of carried) {
          db.update(cards).set({ topicId: newId }).where(eq(cards.topicId, oldId)).run()
          db.update(questions).set({ topicId: newId }).where(eq(questions.topicId, oldId)).run()
        }
        if (old.length > 0) {
          // ON DELETE SET NULL detaches items of topics that did not carry over.
          db.delete(topics)
            .where(
              inArray(
                topics.id,
                old.map((t) => t.id)
              )
            )
            .run()
        }
        const fresh = rowsOf(docId)
        relinkOrphans(docId, fresh)
        return fresh.map(toTopic)
      })
    },

    list(docId) {
      return rowsOf(docId).map(toTopic)
    },

    get(topicId) {
      const row = getRow(topicId)
      return row ? toTopic(row) : null
    },

    forPage(docId, page) {
      const row = deepestFor(rowsOf(docId), page)
      return row ? toTopic(row) : null
    },

    updateEstimates(topicId, estimates) {
      const result = db.update(topics).set({ estimates }).where(eq(topics.id, topicId)).run()
      if (result.changes === 0) throw new NotFoundError('Topic', topicId)
    },

    mastery(topicId) {
      const row = getRow(topicId)
      return row ? belief(row) : null
    },

    addMasteryEvidence(topicId, correct, incorrect) {
      return ctx.tx(() => {
        const row = getRow(topicId)
        if (!row) throw new NotFoundError('Topic', topicId)
        const prior = belief(row) ?? PRIOR
        const next: MasteryBelief = {
          alpha: prior.alpha + nonNegative(correct),
          beta: prior.beta + nonNegative(incorrect)
        }
        db.update(topics)
          .set({ masteryAlpha: next.alpha, masteryBeta: next.beta })
          .where(eq(topics.id, topicId))
          .run()
        return next
      })
    },

    minutesSpent(topicId) {
      const row = getRow(topicId)
      if (!row) return 0
      const total = db
        .select({ seconds: sql<number | null>`sum(${reading.seconds})` })
        .from(reading)
        .where(and(eq(reading.docId, row.docId), between(reading.page, row.pageStart, row.pageEnd)))
        .get()
      return (total?.seconds ?? 0) / 60
    }
  }
}

/** Evidence counts may be fractional (partial credit) but never negative or NaN. */
function nonNegative(n: number): number {
  return Number.isFinite(n) && n > 0 ? n : 0
}
