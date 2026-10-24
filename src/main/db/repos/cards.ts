import { and, asc, eq, inArray, lte, sql } from 'drizzle-orm'
import type { Card, IsoDate, SrsData } from '@shared/domain'
import { clampLimit, iso, normalisePages, NotFoundError, type RepoContext } from '../context'
import { scopeCondition } from '../scope'
import { cardReviews, cards, documents } from '../schema'
import type { CardRepo } from '../types'

type CardRow = typeof cards.$inferSelect

/**
 * SRS data of a never-reviewed card. Identical to ts-fsrs `createEmptyCard(now)` (and so to
 * `Srs.newCard`); kept local because the db layer must not depend on the srs module. A test in
 * cards.test.ts asserts the two stay equal.
 */
export function initialSrs(now: IsoDate): SrsData {
  return {
    due: now,
    stability: 0,
    difficulty: 0,
    reps: 0,
    lapses: 0,
    state: 'new',
    lastReview: null,
    elapsedDays: 0,
    scheduledDays: 0,
    learningSteps: 0
  }
}

function srsColumns(srs: SrsData) {
  return {
    due: iso(srs.due),
    stability: srs.stability,
    difficulty: srs.difficulty,
    reps: srs.reps,
    lapses: srs.lapses,
    srsState: srs.state,
    lastReview: srs.lastReview === null ? null : iso(srs.lastReview),
    elapsedDays: srs.elapsedDays,
    scheduledDays: srs.scheduledDays,
    learningSteps: srs.learningSteps
  }
}

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    docId: row.docId,
    topicId: row.topicId,
    type: row.type,
    front: row.front,
    back: row.back,
    essential: row.essential,
    sourcePages: row.sourcePages,
    evidence: row.evidence,
    verification: row.verification,
    status: row.status,
    srs: {
      due: row.due,
      stability: row.stability,
      difficulty: row.difficulty,
      reps: row.reps,
      lapses: row.lapses,
      state: row.srsState,
      lastReview: row.lastReview,
      elapsedDays: row.elapsedDays,
      scheduledDays: row.scheduledDays,
      learningSteps: row.learningSteps
    },
    createdAt: row.createdAt
  }
}

export function createCardRepo(ctx: RepoContext): CardRepo {
  const { db } = ctx

  const mustGet = (cardId: string): Card => {
    const row = db.select().from(cards).where(eq(cards.id, cardId)).get()
    if (!row) throw new NotFoundError('Card', cardId)
    return toCard(row)
  }

  const ofDoc = (docId: string | null) => (docId === null ? undefined : eq(cards.docId, docId))
  const ofCourse = (courseId: string | undefined) =>
    courseId === undefined
      ? undefined
      : inArray(
          cards.docId,
          db.select({ id: documents.id }).from(documents).where(eq(documents.courseId, courseId))
        )
  const active = eq(cards.status, 'active')

  return {
    insertMany(newCards, now) {
      const createdAt = iso(now)
      return ctx.tx(() =>
        newCards.map((c) => {
          const id = ctx.newId()
          db.insert(cards)
            .values({
              id,
              docId: c.docId,
              topicId: c.topicId,
              type: c.type,
              front: c.front,
              back: c.back,
              essential: c.essential,
              sourcePages: normalisePages(c.sourcePages),
              evidence: c.evidence,
              verification: c.verification,
              status: 'active',
              ...srsColumns(initialSrs(createdAt)),
              createdAt
            })
            .run()
          return mustGet(id)
        })
      )
    },

    get(cardId) {
      const row = db.select().from(cards).where(eq(cards.id, cardId)).get()
      return row ? toCard(row) : null
    },

    list(scope, includeInactive) {
      const inScope = scopeCondition(db, cards, scope)
      return db
        .select()
        .from(cards)
        .where(includeInactive ? inScope : and(inScope, active))
        .orderBy(asc(cards.createdAt), asc(sql`rowid`))
        .all()
        .map(toCard)
    },

    fronts(docId) {
      // Includes suspended/reported cards: a rejected card must not be regenerated either.
      return db
        .select({ front: cards.front })
        .from(cards)
        .where(eq(cards.docId, docId))
        .all()
        .map((r) => r.front)
    },

    due(docId, now, limit, courseId) {
      return db
        .select()
        .from(cards)
        .where(and(ofDoc(docId), ofCourse(courseId), active, lte(cards.due, iso(now))))
        .orderBy(asc(cards.due), asc(sql`rowid`))
        .limit(clampLimit(limit))
        .all()
        .map(toCard)
    },

    update(cardId, patch) {
      const set = {
        ...(patch.front !== undefined ? { front: patch.front } : {}),
        ...(patch.back !== undefined ? { back: patch.back } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {})
      }
      if (Object.keys(set).length > 0) db.update(cards).set(set).where(eq(cards.id, cardId)).run()
      return mustGet(cardId)
    },

    saveReview(cardId, srs, log) {
      return ctx.tx(() => {
        const before = mustGet(cardId).srs
        db.update(cards).set(srsColumns(srs)).where(eq(cards.id, cardId)).run()
        db.insert(cardReviews)
          .values({
            cardId,
            rating: log.rating,
            reviewedAt: iso(log.reviewedAt),
            elapsedMs: Math.max(0, Math.round(log.elapsedMs)),
            srsBefore: before,
            srsAfter: srs
          })
          .run()
        return mustGet(cardId)
      })
    },

    stats(docId, now, courseId) {
      // Counts cover the active deck only; suspended/reported cards are not studied.
      const nowIso = iso(now)
      const row = db
        .select({
          due: sql<number>`coalesce(sum(case when ${cards.due} <= ${nowIso} then 1 else 0 end), 0)`,
          new: sql<number>`coalesce(sum(case when ${cards.srsState} = 'new' then 1 else 0 end), 0)`,
          learning: sql<number>`coalesce(sum(case when ${cards.srsState} in ('learning', 'relearning') then 1 else 0 end), 0)`,
          review: sql<number>`coalesce(sum(case when ${cards.srsState} = 'review' then 1 else 0 end), 0)`,
          total: sql<number>`count(*)`,
          // Canonical ISO strings sort chronologically, so min() is the earliest upcoming due date.
          nextDue: sql<string | null>`min(case when ${cards.due} > ${nowIso} then ${cards.due} end)`
        })
        .from(cards)
        .where(and(ofDoc(docId), ofCourse(courseId), active))
        .get()
      return row ?? { due: 0, new: 0, learning: 0, review: 0, total: 0, nextDue: null }
    }
  }
}
