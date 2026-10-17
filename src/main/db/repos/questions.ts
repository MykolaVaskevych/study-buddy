import { and, asc, eq, sql } from 'drizzle-orm'
import type { Question, QuestionId } from '@shared/domain'
import { clampLimit, iso, normalisePages, NotFoundError, type RepoContext } from '../context'
import { scopeCondition } from '../scope'
import { questions } from '../schema'
import type { QuestionPurpose, QuestionRepo } from '../types'

type QuestionRow = typeof questions.$inferSelect

function toQuestion(row: QuestionRow): Question {
  return {
    id: row.id,
    docId: row.docId,
    topicId: row.topicId,
    type: row.type,
    stem: row.stem,
    options: row.options,
    answer: row.answer,
    explanation: row.explanation,
    optionRationales: row.optionRationales,
    difficulty: row.difficulty,
    sourcePages: row.sourcePages,
    evidence: row.evidence,
    verification: row.verification,
    status: row.status,
    fromBook: row.fromBook,
    createdAt: row.createdAt
  }
}

export function createQuestionRepo(ctx: RepoContext): QuestionRepo {
  const { db, sqlite } = ctx

  const getRow = (id: QuestionId) => db.select().from(questions).where(eq(questions.id, id)).get()

  /**
   * A question is a "mistake" while its most recent attempt (across all quizzes) is not correct.
   * Partial credit counts as a mistake: the point is to revisit it.
   */
  const mistakesStmt = sqlite.prepare<[string, number], { id: string }>(`
    select a.question_id as id
    from quiz_attempts a
    join questions q on q.id = a.question_id
    where q.doc_id = ? and q.status = 'active'
      and a.id = (
        select b.id from quiz_attempts b
        where b.question_id = a.question_id
        order by b.created_at desc, b.id desc
        limit 1
      )
      and a.correct = 0
    order by a.created_at desc, a.id desc
    limit ?`)

  return {
    insertMany(newQuestions, now, purpose: QuestionPurpose = 'quiz') {
      const createdAt = iso(now)
      return ctx.tx(() =>
        newQuestions.map((q) => {
          const id = ctx.newId()
          db.insert(questions)
            .values({
              id,
              docId: q.docId,
              topicId: q.topicId,
              type: q.type,
              purpose,
              stem: q.stem,
              options: q.options,
              answer: q.answer,
              explanation: q.explanation,
              optionRationales: q.optionRationales,
              difficulty: q.difficulty,
              sourcePages: normalisePages(q.sourcePages),
              evidence: q.evidence,
              verification: q.verification,
              status: 'active',
              fromBook: q.fromBook,
              createdAt
            })
            .run()
          const row = getRow(id)
          if (!row) throw new NotFoundError('Question', id)
          return toQuestion(row)
        })
      )
    },

    get(questionId) {
      const row = getRow(questionId)
      return row ? toQuestion(row) : null
    },

    list(scope, opts) {
      const conditions = [scopeCondition(db, questions, scope)]
      if (opts.purpose === 'page_check') conditions.push(eq(questions.purpose, 'page_check'))
      if (!opts.includeInactive) conditions.push(eq(questions.status, 'active'))
      return db
        .select()
        .from(questions)
        .where(and(...conditions))
        .orderBy(asc(questions.createdAt), asc(sql`rowid`))
        .all()
        .map(toQuestion)
    },

    stems(docId) {
      return db
        .select({ stem: questions.stem })
        .from(questions)
        .where(eq(questions.docId, docId))
        .all()
        .map((r) => r.stem)
    },

    setStatus(questionId, status, reason) {
      const result = db
        .update(questions)
        .set({ status, statusReason: reason ?? null })
        .where(eq(questions.id, questionId))
        .run()
      if (result.changes === 0) throw new NotFoundError('Question', questionId)
    },

    mistakes(docId, limit) {
      return mistakesStmt.all(docId, clampLimit(limit)).map((r) => r.id)
    }
  }
}
