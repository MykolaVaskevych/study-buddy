import { and, asc, desc, eq, inArray, isNotNull, max } from 'drizzle-orm'
import type { IsoDate, QuestionId, QuizResult } from '@shared/domain'
import { clampLimit, iso, NotFoundError, type RepoContext } from '../context'
import { quizAttempts, quizzes } from '../schema'
import type { QuizRepo } from '../types'

/** Ids per IN (...) list; far below SQLite's bound-parameter limit. */
const ID_BATCH = 500

export function createQuizRepo(ctx: RepoContext): QuizRepo {
  const { db } = ctx

  return {
    create(quiz, now) {
      const id = ctx.newId()
      db.insert(quizzes)
        .values({
          id,
          docId: quiz.docId,
          mode: quiz.mode,
          scope: quiz.scope,
          questionIds: [...quiz.questionIds],
          timeLimit: quiz.timeLimit,
          createdAt: iso(now)
        })
        .run()
      return id
    },

    get(quizId) {
      const row = db.select().from(quizzes).where(eq(quizzes.id, quizId)).get()
      if (!row) return null
      return {
        id: row.id,
        docId: row.docId,
        mode: row.mode,
        scope: row.scope,
        questionIds: row.questionIds,
        timeLimit: row.timeLimit,
        createdAt: row.createdAt,
        finishedAt: row.finishedAt
      }
    },

    saveAttempt(quizId, attempt, response, elapsedMs, now) {
      // Answering the same question again within a quiz replaces the earlier attempt.
      const values = {
        correct: attempt.correct,
        score: attempt.score,
        result: attempt,
        response: response ?? null,
        elapsedMs: Math.max(0, Math.round(elapsedMs)),
        createdAt: iso(now)
      }
      db.insert(quizAttempts)
        .values({ quizId, questionId: attempt.questionId, ...values })
        .onConflictDoUpdate({ target: [quizAttempts.quizId, quizAttempts.questionId], set: values })
        .run()
    },

    attempts(quizId) {
      return db
        .select({ result: quizAttempts.result })
        .from(quizAttempts)
        .where(eq(quizAttempts.quizId, quizId))
        .orderBy(asc(quizAttempts.createdAt), asc(quizAttempts.id))
        .all()
        .map((r) => r.result)
    },

    lastAttemptAt(questionIds) {
      const out = new Map<QuestionId, IsoDate>()
      const ids = [...new Set(questionIds)]
      for (let i = 0; i < ids.length; i += ID_BATCH) {
        const rows = db
          .select({ questionId: quizAttempts.questionId, at: max(quizAttempts.createdAt) })
          .from(quizAttempts)
          .where(inArray(quizAttempts.questionId, ids.slice(i, i + ID_BATCH)))
          .groupBy(quizAttempts.questionId)
          .all()
        for (const row of rows) if (row.at !== null) out.set(row.questionId, row.at)
      }
      return out
    },

    finish(quizId, result: QuizResult) {
      const changes = db
        .update(quizzes)
        .set({ result, finishedAt: iso(result.finishedAt) })
        .where(eq(quizzes.id, quizId))
        .run().changes
      if (changes === 0) throw new NotFoundError('Quiz', quizId)
    },

    history(docId, limit) {
      return db
        .select({ result: quizzes.result })
        .from(quizzes)
        .where(and(eq(quizzes.docId, docId), isNotNull(quizzes.result)))
        .orderBy(desc(quizzes.finishedAt))
        .limit(clampLimit(limit))
        .all()
        .flatMap((r) => (r.result ? [r.result] : []))
    }
  }
}
