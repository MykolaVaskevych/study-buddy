import type {
  AttemptResult,
  DocId,
  Exercise,
  Question,
  QuestionId,
  QuestionResponse,
  QuestionType,
  QuizMode,
  QuizSession,
  Scope,
  Topic,
  TopicId
} from '@shared/domain'
import { formatAnswer, gradeObjective } from '@shared/grading'
import type { NewQuestion } from '../db/types'
import { notFound } from './errors'
import type { JobWaiter } from './job-waiter'
import { addEvidence, resolveTopic, topicForPages } from './learning'
import { createSession, type PageChecks } from './page-checks'
import type { Planner } from './planner'
import { PRIORITY } from './priorities'
import type { QuestionGen } from './questions'
import { leafTopics, leavesUnder, resolveScope, scopeLabel, type ResolvedScope } from './scope'
import { mockAllocation, pickFresh, reviewPages, rubricFromAnswer } from './selection'
import type { IpcParsedInput } from '@shared/ipc/contract'
import type { Handlers, PipelineDeps } from './types'
import { ServiceError } from './types'
import type { UsageLedger } from './usage'

/**
 * Quizzes: building sessions (reuse stored questions first, generate only what is missing),
 * grading answers (deterministic, or the AI for written answers), mastery evidence, results.
 */
export interface Quizzes {
  handlers: Pick<
    Handlers,
    'quiz.create' | 'quiz.pageCheck' | 'quiz.answer' | 'quiz.finish' | 'quiz.history' | 'quiz.reportQuestion'
  >
}

/** Stored questions below this difficulty are too easy to reuse in a mock exam. */
export const MOCK_MIN_DIFFICULTY = 3
/** Mistakes are scanned this deep before the scope filter. */
const MISTAKES_SCAN = 500

type CreateInput = IpcParsedInput<'quiz.create'>

const normStem = (stem: string): string => stem.replace(/\s+/g, ' ').trim().toLowerCase()

/** A book exercise with its answer as a written question; the book's answer is the model answer. */
export function bookQuestion(
  docId: DocId,
  topicId: TopicId | null,
  page: number,
  exercise: Exercise & { answer: string }
): NewQuestion {
  return {
    docId,
    topicId,
    type: 'short',
    stem: exercise.question,
    options: null,
    answer: { type: 'short', modelAnswer: exercise.answer, rubric: rubricFromAnswer(exercise.answer) },
    explanation: `This is the worked answer given in the book (page ${page}).`,
    optionRationales: null,
    difficulty: 2,
    sourcePages: [page],
    evidence: null,
    verification: 'not_applicable',
    fromBook: true
  }
}

export function createQuizzes(
  deps: Pick<PipelineDeps, 'db' | 'emit' | 'now'>,
  services: {
    ledger: UsageLedger
    questionGen: QuestionGen
    pageChecks: PageChecks
    planner: Planner
    waiter: JobWaiter
  }
): Quizzes {
  const { db } = deps
  const { questionGen, waiter } = services
  const nowIso = (): string => deps.now().toISOString()

  const session = (
    docId: DocId,
    mode: QuizMode,
    scope: Scope,
    questions: Question[],
    timeLimit: number | null
  ): QuizSession => createSession(db, nowIso(), { docId, mode, scope, questions, timeLimit })

  /** Fresh stored questions in a scope (any purpose unless filtered), best first. */
  const freshIn = (
    scope: Scope,
    limit: number,
    types: readonly QuestionType[] | null,
    keep: (q: Question) => boolean = () => true,
    exclude?: ReadonlySet<QuestionId>
  ): Question[] => {
    const list = db.questions.list(scope, { purpose: 'any', includeInactive: false }).filter(keep)
    const answered = db.quizzes.lastAttemptAt(list.map((q) => q.id))
    return pickFresh(list, answered, deps.now(), { limit, types, ...(exclude ? { exclude } : {}) })
  }

  /** Waits for a generation job; with something already picked, a failure just means a shorter quiz. */
  const awaitTopUp = async (jobId: string, havePartial: boolean): Promise<void> => {
    try {
      await waiter.done(jobId)
    } catch (err) {
      if (!havePartial) throw err
    }
  }

  async function topicQuiz(input: CreateInput, mode: QuizMode): Promise<QuizSession> {
    const resolved = resolveScope(db, input.scope)
    let picked = freshIn(input.scope, input.count, input.types)
    if (picked.length < input.count) {
      const job = questionGen.enqueueQuestions(
        { scope: input.scope, count: input.count - picked.length, types: input.types, purpose: 'quiz' },
        PRIORITY.awaited
      )
      await awaitTopUp(job.id, picked.length > 0)
      picked = freshIn(input.scope, input.count, input.types)
    }
    if (picked.length === 0) {
      throw new ServiceError('validation', `No questions could be made for ${scopeLabel(resolved)}`)
    }
    return session(resolved.doc.id, mode, input.scope, picked, input.timeLimit)
  }

  async function mockQuiz(input: CreateInput): Promise<QuizSession> {
    const resolved = resolveScope(db, input.scope)
    const docId = resolved.doc.id
    const topics = db.topics.list(docId)
    const leaves = (resolved.topic ? leavesUnder(topics, resolved.topic.id) : leafTopics(topics)).filter(
      (t) => t.pageEnd >= resolved.from && t.pageStart <= resolved.to
    )
    const startedAt = nowIso()
    let pageCheckIds = new Set<QuestionId>()
    const refreshPageChecks = (): void => {
      pageCheckIds = new Set(
        db.questions.list(input.scope, { purpose: 'page_check', includeInactive: true }).map((q) => q.id)
      )
    }
    refreshPageChecks()
    // Exam style only: page checks are deliberately easy, and so are many older quiz questions.
    // Questions generated for this exam (purpose 'mock') are taken whatever difficulty they got.
    const examStyle = (q: Question): boolean =>
      !pageCheckIds.has(q.id) && (q.difficulty >= MOCK_MIN_DIFFICULTY || q.createdAt >= startedAt)
    if (leaves.length === 0) return mockWithoutTopics(input, resolved, examStyle, refreshPageChecks)

    const pagesOf = (t: Topic): number => Math.max(1, t.pageEnd - t.pageStart + 1)
    const totalPages = leaves.reduce((sum, t) => sum + pagesOf(t), 0)
    const allocation = mockAllocation(
      leaves.map((t) => ({
        id: t.id,
        weight: t.estimates?.examWeight ?? pagesOf(t) / totalPages,
        mastery: t.mastery
      })),
      input.count
    )
    const chosen = new Set<QuestionId>()
    const byTopic = new Map<TopicId, Question[]>()
    const topUp = (t: Topic, want: number): void => {
      const have = byTopic.get(t.id) ?? []
      const scope: Scope = { kind: 'topic', docId, topicId: t.id }
      const more = freshIn(scope, want - have.length, input.types, examStyle, chosen)
      for (const q of more) chosen.add(q.id)
      byTopic.set(t.id, [...have, ...more])
    }
    const pending: { topic: Topic; want: number; jobId: string }[] = []
    for (const t of leaves) {
      const want = allocation.get(t.id) ?? 0
      if (want <= 0) continue
      topUp(t, want)
      const missing = want - (byTopic.get(t.id)?.length ?? 0)
      if (missing > 0) {
        const job = questionGen.enqueueQuestions(
          {
            scope: { kind: 'topic', docId, topicId: t.id },
            count: missing,
            types: input.types,
            purpose: 'mock'
          },
          PRIORITY.awaited
        )
        pending.push({ topic: t, want, jobId: job.id })
      }
    }
    const outcomes = await Promise.allSettled(pending.map((p) => waiter.done(p.jobId)))
    refreshPageChecks()
    pending.forEach((p, i) => {
      if (outcomes[i]?.status === 'fulfilled') topUp(p.topic, p.want)
    })
    const questions = leaves.flatMap((t) => byTopic.get(t.id) ?? [])
    if (questions.length === 0) {
      const failure = outcomes.find((o) => o.status === 'rejected')
      if (failure?.status === 'rejected') throw failure.reason
      throw new ServiceError('validation', `No exam questions could be made for ${scopeLabel(resolved)}`)
    }
    return session(docId, 'mock', input.scope, questions, input.timeLimit)
  }

  /** Before the topic map exists: one mock generation over the scope, split into windows by the job. */
  async function mockWithoutTopics(
    input: CreateInput,
    resolved: ResolvedScope,
    examStyle: (q: Question) => boolean,
    refreshPageChecks: () => void
  ): Promise<QuizSession> {
    let picked = freshIn(input.scope, input.count, input.types, examStyle)
    if (picked.length < input.count) {
      const job = questionGen.enqueueQuestions(
        { scope: input.scope, count: input.count - picked.length, types: input.types, purpose: 'mock' },
        PRIORITY.awaited
      )
      await awaitTopUp(job.id, picked.length > 0)
      refreshPageChecks()
      picked = freshIn(input.scope, input.count, input.types, examStyle)
    }
    if (picked.length === 0) {
      throw new ServiceError('validation', `No exam questions could be made for ${scopeLabel(resolved)}`)
    }
    return session(resolved.doc.id, 'mock', input.scope, picked, input.timeLimit)
  }

  function bookQuiz(input: CreateInput): QuizSession {
    const resolved = resolveScope(db, input.scope)
    const docId = resolved.doc.id
    const notes = db.pages.notesInRange(docId, resolved.from, resolved.to).filter((n) => n.indexed)
    const exercises = notes.flatMap((n) =>
      n.exercises.flatMap((e) =>
        e.answer !== null && e.question.trim() !== ''
          ? [{ page: n.page, exercise: { ...e, answer: e.answer } }]
          : []
      )
    )
    if (exercises.length === 0) {
      const pending = notes.length < resolved.to - resolved.from + 1 ? ' yet (indexing is not finished)' : ''
      throw new ServiceError(
        'validation',
        `No exercises with worked answers found in ${scopeLabel(resolved)}${pending}`
      )
    }
    const range: Scope = { kind: 'range', docId, from: resolved.from, to: resolved.to }
    const existing = db.questions
      .list(range, { purpose: 'any', includeInactive: true })
      .filter((q) => q.fromBook)
    const known = new Set(existing.map((q) => normStem(q.stem)))
    const missing = exercises.filter((e) => !known.has(normStem(e.exercise.question)))
    const created = db.questions.insertMany(
      missing.map((e) => bookQuestion(docId, topicForPages(db, docId, [e.page]), e.page, e.exercise)),
      nowIso(),
      'quiz'
    )
    const all = [...existing, ...created]
      .filter((q) => q.status === 'active')
      .sort((a, b) => (a.sourcePages[0] ?? 0) - (b.sourcePages[0] ?? 0))
    const answered = db.quizzes.lastAttemptAt(all.map((q) => q.id))
    let picked = pickFresh(all, answered, deps.now(), { limit: input.count })
    // The book has only so many exercises: practising them again soon is fine, least recent first.
    if (picked.length === 0) {
      picked = [...all]
        .sort((a, b) => (answered.get(a.id) ?? '').localeCompare(answered.get(b.id) ?? ''))
        .slice(0, input.count)
    }
    if (picked.length === 0) throw new ServiceError('validation', `All book exercises here were reported`)
    return session(docId, 'from_book', input.scope, picked, input.timeLimit)
  }

  function mistakesQuiz(input: CreateInput): QuizSession {
    const resolved = resolveScope(db, input.scope)
    const inScope = (q: Question): boolean =>
      input.scope.kind === 'document' || q.sourcePages.some((p) => p >= resolved.from && p <= resolved.to)
    const questions = db.questions
      .mistakes(resolved.doc.id, MISTAKES_SCAN)
      .flatMap((id) => {
        const q = db.questions.get(id)
        return q && q.status === 'active' && inScope(q) ? [q] : []
      })
      .slice(0, input.count)
    if (questions.length === 0) {
      throw new ServiceError('validation', `No mistakes to review in ${scopeLabel(resolved)}`)
    }
    return session(resolved.doc.id, 'review_mistakes', input.scope, questions, input.timeLimit)
  }

  async function grade(question: Question, response: QuestionResponse): Promise<AttemptResult> {
    const objective = gradeObjective(question, response)
    if (objective) return objective
    const base = { questionId: question.id, correctAnswer: formatAnswer(question) }
    if (response.type !== 'short') {
      return {
        ...base,
        correct: false,
        score: 0,
        feedback: 'This question needs a written answer.',
        missingPoints: []
      }
    }
    if (response.text.trim() === '') {
      // No call for an empty answer.
      const rubric = question.answer.type === 'short' ? question.answer.rubric : []
      return { ...base, correct: false, score: 0, feedback: 'No answer given.', missingPoints: rubric }
    }
    const graded = await services.ledger.run(question.docId, (ai) =>
      ai.gradeShortAnswer({ question, response: response.text })
    )
    return {
      ...base,
      correct: graded.verdict === 'correct',
      score: Math.min(1, Math.max(0, graded.score)),
      feedback: graded.feedback,
      missingPoints: graded.missingPoints
    }
  }

  /**
   * A wrong answer becomes a "My mistakes" flashcard (no AI call): the question on the front, the
   * right answer and the explanation on the back. The gaps a student actually has get reviewed.
   */
  const addMistakeCard = (question: Question, correctAnswer: string): void => {
    const front = question.options
      ? `${question.stem}\n\n${question.options.map((o, i) => `${String.fromCharCode(65 + i)}. ${o}`).join('\n')}`
      : question.stem
    if (db.cards.fronts(question.docId).some((f) => normStem(f) === normStem(front))) return
    db.cards.insertMany(
      [
        {
          docId: question.docId,
          topicId: resolveTopic(db, question),
          type: 'mistake',
          front,
          back: `${correctAnswer}\n\n${question.explanation}`.trim(),
          essential: true,
          sourcePages: question.sourcePages,
          evidence: question.evidence,
          verification: question.verification
        }
      ],
      nowIso()
    )
    deps.emit('cards.changed', { docId: question.docId })
  }

  return {
    handlers: {
      'quiz.create': async (input) => {
        switch (input.mode) {
          case 'page_check':
            return input.scope.kind === 'page'
              ? services.pageChecks.pageCheck(input.scope.docId, input.scope.page)
              : topicQuiz(input, 'page_check')
          case 'topic':
            return topicQuiz(input, 'topic')
          case 'mock':
            return mockQuiz(input)
          case 'from_book':
            return bookQuiz(input)
          case 'review_mistakes':
            return mistakesQuiz(input)
        }
      },

      'quiz.pageCheck': ({ docId, page }) => services.pageChecks.pageCheck(docId, page),

      'quiz.answer': async ({ quizId, questionId, response, elapsedMs }) => {
        const quiz = db.quizzes.get(quizId)
        if (!quiz) throw notFound('Quiz', quizId)
        if (!quiz.questionIds.includes(questionId)) {
          throw new ServiceError('validation', 'This question is not part of the quiz')
        }
        if (quiz.finishedAt !== null) throw new ServiceError('conflict', 'This quiz is already finished')
        const question = db.questions.get(questionId)
        if (!question) throw notFound('Question', questionId)
        const answeredBefore = db.quizzes.attempts(quizId).some((a) => a.questionId === questionId)
        const result = await grade(question, response)
        db.quizzes.saveAttempt(quizId, result, response, elapsedMs, nowIso())
        // A changed answer within the same quiz is not new evidence.
        if (!answeredBefore) addEvidence(db, resolveTopic(db, question), result.score >= 0.5)
        if (!answeredBefore && result.score < 0.5) addMistakeCard(question, result.correctAnswer)
        return result
      },

      'quiz.finish': async ({ quizId }) => {
        const quiz = db.quizzes.get(quizId)
        if (!quiz) throw notFound('Quiz', quizId)
        const attempts = db.quizzes.attempts(quizId)
        const byQuestion = new Map(attempts.map((a) => [a.questionId, a]))
        const questions = new Map<QuestionId, Question>()
        for (const id of quiz.questionIds) {
          const q = db.questions.get(id)
          if (q) questions.set(id, q)
        }
        const perTopic = new Map<TopicId | null, { score: number; maxScore: number }>()
        for (const q of questions.values()) {
          const topicId = resolveTopic(db, q)
          const entry = perTopic.get(topicId) ?? { score: 0, maxScore: 0 }
          entry.score += byQuestion.get(q.id)?.score ?? 0
          entry.maxScore += 1
          perTopic.set(topicId, entry)
        }
        const result = {
          quizId,
          score: [...perTopic.values()].reduce((sum, t) => sum + t.score, 0),
          maxScore: questions.size,
          attempts,
          perTopic: [...perTopic.entries()].map(([topicId, t]) => ({ topicId, ...t })),
          reviewPages: reviewPages(attempts, questions),
          finishedAt: nowIso()
        }
        db.quizzes.finish(quizId, result)
        // New evidence moved mastery, so the saved plan's expected score and levels are stale.
        services.planner.replanIfSaved(quiz.docId)
        deps.emit('library.changed', { docId: quiz.docId })
        return result
      },

      'quiz.history': async ({ docId, limit }) => db.quizzes.history(docId, limit),

      'quiz.reportQuestion': async ({ questionId, reason }) => {
        db.questions.setStatus(questionId, 'reported', reason.trim() === '' ? undefined : reason.trim())
        return { ok: true }
      }
    }
  }
}
