import type { IpcErrorKind, IpcEvent, IpcEvents, IpcInput, IpcOutput } from '@shared/ipc/contract'
import type {
  AttemptResult,
  Card,
  JobInfo,
  Question,
  QuestionResponse,
  QuestionType,
  QuizResult,
  QuizSession,
  Rating,
  Scope
} from '@shared/domain'
import { formatAnswer, gradeObjective } from '@shared/grading'
import { flattenTopics, slideFor } from './mock-data'
import type { BookSpec, SlideSpec } from './mock-data'
import { CARD_BANK, cardFromSeed, QUESTION_BANK } from './mock-study-bank'
import type { QuestionSeed } from './mock-study-bank'

/**
 * Flashcards and quizzes for the mock api (browser mode and tests): page checks with all five
 * question types, real deterministic grading (src/shared/grading), a keyword grader for short
 * answers, FSRS-like scheduling, card generation jobs that tick, and quiz history.
 */

export type StudyChannel =
  | 'cards.generate'
  | 'cards.list'
  | 'cards.due'
  | 'cards.review'
  | 'cards.update'
  | 'cards.setStatus'
  | 'cards.stats'
  | 'quiz.create'
  | 'quiz.pageCheck'
  | 'quiz.answer'
  | 'quiz.finish'
  | 'quiz.history'
  | 'quiz.reportQuestion'

export type StudyHandlers = { [C in StudyChannel]: (input: IpcInput<C>) => IpcOutput<C> }

/** The part of the mock's document state this module needs. */
export interface StudyDoc {
  spec: BookSpec
  title: string
  topicsBuilt: boolean
  cards: Card[]
}

export interface StudyMockContext {
  docs: Map<string, StudyDoc>
  now: () => Date
  nextId: (prefix: string) => string
  emit: <E extends IpcEvent>(event: E, payload: IpcEvents[E]) => void
  upsertJob: (job: JobInfo) => void
  fail: (kind: IpcErrorKind, message: string) => never
  /** Runs `fn` later when simulating, immediately otherwise. */
  later: (fn: () => void, ms: number) => void
  simulate: boolean
}

const DAY = 86_400_000

/** Seed deck of a book. */
export function makeCards(spec: BookSpec, now: Date): Card[] {
  return (CARD_BANK[spec.id] ?? []).map((seed, i) => cardFromSeed(spec.id, seed, i, now, spec.topicsBuilt))
}

const templateTitle = (title: string): string => title.replace(/ \(\d+\)$/, '')

/** Questions derived from a slide when the bank has none for it. */
function genericSeeds(slide: SlideSpec, page: number): QuestionSeed[] {
  const out: QuestionSeed[] = []
  const formula = slide.formulas?.[0]
  if (formula) {
    out.push({
      type: 'mcq',
      stem: `Which formula gives: ${formula.meaning.replace(/\.$/, '')}?`,
      options: ['$V = IR$', `$${formula.latex}$`, '$P = I^2 R$', '$E = mc^2$'],
      answer: { type: 'mcq', correctIndex: 1 },
      explanation: `The formula is on [p. ${page}].`,
      optionRationales: null
    })
  } else {
    out.push({
      type: 'mcq',
      stem: `What is page ${page} mainly about?`,
      options: ['Copper cabling', slide.title, 'Wireless links', 'Satellite links'],
      answer: { type: 'mcq', correctIndex: 1 },
      explanation: `See [p. ${page}].`,
      optionRationales: null
    })
  }
  const point = slide.keyPoints[0]
  if (point) {
    out.push({
      type: 'tf',
      stem: point,
      options: null,
      answer: { type: 'tf', value: true },
      explanation: `This is stated on [p. ${page}].`,
      optionRationales: null
    })
  }
  const concept = slide.concepts?.[0]
  if (concept) {
    const words = concept.definition
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 6)
      .slice(0, 3)
    out.push({
      type: 'short',
      stem: `In your own words: what is ${concept.term.toLowerCase()}?`,
      options: null,
      answer: { type: 'short', modelAnswer: concept.definition, rubric: [concept.definition] },
      explanation: `Defined on [p. ${page}].`,
      optionRationales: null,
      keywords: [words.length ? words : [concept.term.toLowerCase()]]
    })
  }
  return out
}

const normalise = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ')

export function createStudyHandlers(ctx: StudyMockContext): StudyHandlers {
  const { docs, now, nextId, emit, fail } = ctx
  const quizzes = new Map<string, QuizSession>()
  const answers = new Map<string, AttemptResult[]>()
  const results: QuizResult[] = []
  const shortKeywords = new Map<string, string[][]>()
  const reported = new Set<string>()

  const getDoc = (docId: string): StudyDoc =>
    docs.get(docId) ?? fail('not_found', `Document ${docId} not found`)
  const allCards = (): Card[] => [...docs.values()].flatMap((d) => d.cards)
  const findCard = (cardId: string): Card =>
    allCards().find((c) => c.id === cardId) ?? fail('not_found', `Card ${cardId} not found`)
  const replaceCard = (next: Card): Card => {
    const d = getDoc(next.docId)
    d.cards = d.cards.map((c) => (c.id === next.id ? next : c))
    return next
  }

  const topicRange = (d: StudyDoc, topicId: string): { from: number; to: number } => {
    const hit = flattenTopics(d.spec.topics).find(({ spec }) => `${d.spec.id}:${spec.title}` === topicId)
    return hit ? { from: hit.spec.from, to: hit.spec.to } : fail('not_found', `Topic ${topicId} not found`)
  }

  const scopeRange = (scope: Scope): { from: number; to: number } => {
    const d = getDoc(scope.docId)
    switch (scope.kind) {
      case 'page':
        return { from: scope.page, to: scope.page }
      case 'range':
        return { from: Math.min(scope.from, scope.to), to: Math.max(scope.from, scope.to) }
      case 'topic':
        return topicRange(d, scope.topicId)
      case 'document':
        return { from: 1, to: d.spec.pageCount }
    }
  }

  const inScope = (c: Card, scope: Scope): boolean => {
    if (c.docId !== scope.docId) return false
    if (scope.kind === 'document') return true
    const { from, to } = scopeRange(scope)
    if (scope.kind === 'topic' && c.topicId !== null) {
      // The topic or one of its subtopics (their ranges nest inside the parent's).
      const own = c.topicId === scope.topicId
      return own || c.sourcePages.some((p) => p >= from && p <= to)
    }
    return c.sourcePages.some((p) => p >= from && p <= to)
  }

  // -------------------------------------------------------------- questions

  const toQuestion = (d: StudyDoc, page: number, seed: QuestionSeed, i: number): Question => {
    const slide = slideFor(d.spec, page)
    const id = nextId('q')
    if (seed.keywords) shortKeywords.set(id, seed.keywords)
    return {
      id,
      docId: d.spec.id,
      topicId: slide.topic && d.topicsBuilt ? `${d.spec.id}:${slide.topic}` : null,
      type: seed.type,
      stem: seed.stem,
      options: seed.options,
      answer: seed.answer,
      explanation: seed.explanation,
      optionRationales: seed.optionRationales,
      difficulty: 2 + (i % 3),
      sourcePages: [page],
      evidence: slide.summary || null,
      verification: 'verified',
      status: 'active',
      fromBook: (slide.exercises?.length ?? 0) > 0 && seed.type === 'numeric',
      createdAt: now().toISOString()
    }
  }

  const seedsFor = (d: StudyDoc, page: number): QuestionSeed[] => {
    const slide = slideFor(d.spec, page)
    if (slide.kind === 'title' || slide.kind === 'toc' || slide.kind === 'blank') return []
    const bank = QUESTION_BANK[templateTitle(slide.title)]
    return bank ? bank(page) : genericSeeds(slide, page)
  }

  /** One page per distinct slide template in the range, so a topic quiz doesn't repeat itself. */
  const questionsInRange = (
    d: StudyDoc,
    from: number,
    to: number,
    types: QuestionType[] | null
  ): Question[] => {
    const seen = new Set<string>()
    const perSlide: Question[][] = []
    for (let page = from; page <= Math.min(to, d.spec.pageCount); page++) {
      const key = templateTitle(slideFor(d.spec, page).title)
      if (seen.has(key)) continue
      seen.add(key)
      perSlide.push(
        seedsFor(d, page)
          .filter((s) => !types || types.includes(s.type))
          .map((s, i) => toQuestion(d, page, s, i))
      )
    }
    // Round-robin across slides so a short quiz still covers the whole range.
    const out: Question[] = []
    for (let i = 0; perSlide.some((qs) => i < qs.length); i++) {
      for (const qs of perSlide) {
        const q = qs[i]
        if (q) out.push(q)
      }
    }
    return out
  }

  const gradeShort = (q: Question, text: string): AttemptResult => {
    const rubric = q.answer.type === 'short' ? q.answer.rubric : []
    const groups = shortKeywords.get(q.id) ?? rubric.map((r) => [normalise(r)])
    const answer = normalise(text)
    const hits = groups.map((words) => words.some((w) => answer.includes(normalise(w))))
    const score = groups.length ? hits.filter(Boolean).length / groups.length : 0
    const missingPoints = rubric.filter((_, i) => !hits[i])
    return {
      questionId: q.id,
      correct: score >= 0.999,
      score,
      feedback:
        score >= 0.999
          ? 'You covered every point.'
          : score > 0
            ? 'Good start; a few points are missing.'
            : 'This misses the key points.',
      missingPoints,
      correctAnswer: formatAnswer(q)
    }
  }

  const grade = (q: Question, response: QuestionResponse): AttemptResult => {
    if (response.type === 'short') return gradeShort(q, response.text)
    return (
      gradeObjective(q, response) ?? {
        questionId: q.id,
        correct: false,
        score: 0,
        feedback: null,
        missingPoints: [],
        correctAnswer: formatAnswer(q)
      }
    )
  }

  const session = (
    docId: string,
    mode: QuizSession['mode'],
    scope: Scope,
    questions: Question[],
    timeLimit: number | null
  ): QuizSession => {
    const s: QuizSession = {
      id: nextId('quiz'),
      docId,
      mode,
      scope,
      questions,
      createdAt: now().toISOString(),
      timeLimit
    }
    quizzes.set(s.id, s)
    return s
  }

  /**
   * Like main: untestable pages are refused, and asking again on the same page serves the next
   * questions of the page's bank (main serves the ones not answered recently).
   */
  const pageChecks = new Map<string, number>()
  const pageCheck = (docId: string, page: number): QuizSession => {
    const d = getDoc(docId)
    if (page > d.spec.pageCount) fail('validation', `Page ${page} is past the end`)
    const seeds = seedsFor(d, page)
    if (seeds.length === 0) fail('validation', 'Nothing to test on this page — try the next one')
    const key = `${docId}:${page}`
    const round = pageChecks.get(key) ?? 0
    pageChecks.set(key, round + 1)
    const count = Math.min(3, seeds.length)
    const start = (round * count) % seeds.length
    const picked = Array.from({ length: count }, (_, i) => seeds[(start + i) % seeds.length]).filter(
      (s): s is QuestionSeed => s !== undefined
    )
    const questions = picked.map((s, i) => toQuestion(d, page, s, i))
    return session(docId, 'page_check', { kind: 'page', docId, page }, questions, null)
  }

  const mistakes = (docId: string, scope: Scope): Question[] => {
    const wrong = new Map<string, Question>()
    for (const quiz of quizzes.values()) {
      if (quiz.docId !== docId) continue
      for (const a of answers.get(quiz.id) ?? []) {
        const q = quiz.questions.find((x) => x.id === a.questionId)
        if (!q || a.correct || reported.has(q.id)) continue
        const { from, to } = scopeRange(scope)
        if (q.sourcePages.some((p) => p >= from && p <= to)) wrong.set(q.id, q)
      }
    }
    return [...wrong.values()]
  }

  // -------------------------------------------------------------- cards

  const schedule = (card: Card, rating: Rating): Card => {
    const t = now()
    const prev = Math.max(1, card.srs.scheduledDays)
    const days =
      rating === 1
        ? 10 / (24 * 60)
        : rating === 2
          ? prev * 1.2
          : rating === 3
            ? prev * 2.5
            : Math.max(4, prev * 3.5)
    return {
      ...card,
      srs: {
        ...card.srs,
        due: new Date(t.getTime() + days * DAY).toISOString(),
        stability:
          rating === 1 ? Math.max(0.5, card.srs.stability / 2) : card.srs.stability * (1 + rating / 2),
        reps: card.srs.reps + 1,
        lapses: card.srs.lapses + (rating === 1 ? 1 : 0),
        state: rating === 1 ? (card.srs.state === 'new' ? 'learning' : 'relearning') : 'review',
        lastReview: t.toISOString(),
        elapsedDays: card.srs.lastReview ? (t.getTime() - Date.parse(card.srs.lastReview)) / DAY : 0,
        scheduledDays: rating === 1 ? 0 : Math.round(days)
      }
    }
  }

  /** New cards for a scope from page notes: concepts become basic cards, formulas formula cards. */
  const generatedCards = (
    d: StudyDoc,
    scope: Scope,
    essentialsOnly: boolean,
    count: number | null
  ): Card[] => {
    const { from, to } = scopeRange(scope)
    const fronts = new Set(d.cards.map((c) => c.front))
    const out: Card[] = []
    const t = now()
    for (let page = from; page <= Math.min(to, d.spec.pageCount); page++) {
      const slide = slideFor(d.spec, page)
      const topicId = slide.topic && d.topicsBuilt ? `${d.spec.id}:${slide.topic}` : null
      const make = (type: Card['type'], front: string, back: string, essential: boolean): void => {
        if (fronts.has(front) || (essentialsOnly && !essential)) return
        fronts.add(front)
        out.push({
          ...cardFromSeed(
            d.spec.id,
            { topic: '', type, front, back, page, essential, dueInDays: 0 },
            0,
            t,
            false
          ),
          id: nextId(`${d.spec.id}-card-new`),
          topicId,
          srs: {
            due: t.toISOString(),
            stability: 0,
            difficulty: 5,
            reps: 0,
            lapses: 0,
            state: 'new',
            lastReview: null,
            elapsedDays: 0,
            scheduledDays: 0,
            learningSteps: 0
          }
        })
      }
      for (const c of slide.concepts ?? [])
        make('basic', `What is ${c.term.toLowerCase()}?`, c.definition, c.importance === 'core')
      for (const f of slide.formulas ?? [])
        make('formula', f.meaning.replace(/\.$/, ''), `$$${f.latex}$$`, f.importance === 'core')
    }
    return count === null ? out : out.slice(0, count)
  }

  const runGeneration = (
    d: StudyDoc,
    scope: Scope,
    essentialsOnly: boolean,
    count: number | null
  ): string => {
    const label = `Writing ${essentialsOnly ? 'essential' : 'full'} flashcards for ${d.title}`
    const job: JobInfo = {
      id: nextId('job'),
      kind: 'generate_cards',
      docId: d.spec.id,
      state: ctx.simulate ? 'queued' : 'running',
      progress: 0,
      label,
      error: null,
      attempts: 1,
      createdAt: now().toISOString(),
      updatedAt: now().toISOString()
    }
    ctx.upsertJob(job)
    const finish = (): void => {
      d.cards = [...d.cards, ...generatedCards(d, scope, essentialsOnly, count)]
      ctx.upsertJob({ ...job, state: 'done', progress: 1, updatedAt: now().toISOString() })
      emit('cards.changed', { docId: d.spec.id })
    }
    if (!ctx.simulate) {
      finish()
      return job.id
    }
    const steps = [0.15, 0.4, 0.7, 0.9]
    steps.forEach((progress, i) =>
      ctx.later(
        () => ctx.upsertJob({ ...job, state: 'running', progress, updatedAt: now().toISOString() }),
        500 + i * 700
      )
    )
    ctx.later(finish, 500 + steps.length * 700)
    return job.id
  }

  return {
    'cards.generate': ({ scope, essentialsOnly, count }) => ({
      jobId: runGeneration(getDoc(scope.docId), scope, essentialsOnly, count)
    }),
    'cards.list': ({ scope, includeInactive }) =>
      getDoc(scope.docId)
        .cards.filter((c) => (includeInactive || c.status === 'active') && inScope(c, scope))
        .sort((a, b) => (a.sourcePages[0] ?? 0) - (b.sourcePages[0] ?? 0)),
    'cards.due': ({ docId, limit }) => {
      const t = now().toISOString()
      return allCards()
        .filter((c) => (!docId || c.docId === docId) && c.status === 'active' && c.srs.due <= t)
        .sort((a, b) => a.srs.due.localeCompare(b.srs.due))
        .slice(0, limit)
    },
    'cards.review': ({ cardId, rating }) => {
      const next = replaceCard(schedule(findCard(cardId), rating))
      emit('cards.changed', { docId: next.docId })
      return next
    },
    'cards.update': ({ cardId, front, back }) => replaceCard({ ...findCard(cardId), front, back }),
    'cards.setStatus': ({ cardId, status }) => {
      const next = replaceCard({ ...findCard(cardId), status })
      emit('cards.changed', { docId: next.docId })
      return next
    },
    'cards.stats': ({ docId }) => {
      const t = now().toISOString()
      const cards = allCards().filter((c) => (!docId || c.docId === docId) && c.status === 'active')
      const count = (...s: Card['srs']['state'][]): number =>
        cards.filter((c) => s.includes(c.srs.state)).length
      const upcoming = cards
        .map((c) => c.srs.due)
        .filter((due) => due > t)
        .sort()
      return {
        due: cards.filter((c) => c.srs.due <= t).length,
        new: count('new'),
        learning: count('learning', 'relearning'),
        review: count('review'),
        total: cards.length,
        nextDue: upcoming[0] ?? null
      }
    },

    'quiz.create': ({ scope, mode, count, types, timeLimit }) => {
      const d = getDoc(scope.docId)
      if (mode === 'page_check' && scope.kind === 'page') return pageCheck(scope.docId, scope.page)
      if (mode === 'review_mistakes') {
        const wrong = mistakes(d.spec.id, scope)
        if (wrong.length === 0) fail('validation', 'No mistakes to retry in this scope yet.')
        return session(d.spec.id, mode, scope, wrong.slice(0, count), timeLimit)
      }
      const { from, to } = scopeRange(scope)
      const questions = questionsInRange(d, from, to, types)
      if (questions.length === 0)
        fail('validation', 'There is nothing to ask about in this part of the book yet.')
      return session(d.spec.id, mode, scope, questions.slice(0, count), timeLimit)
    },
    'quiz.pageCheck': ({ docId, page }) => pageCheck(docId, page),
    'quiz.answer': ({ quizId, questionId, response }) => {
      const quiz = quizzes.get(quizId)
      const q = quiz?.questions.find((x) => x.id === questionId)
      if (!quiz || !q) return fail('not_found', 'Question not found')
      const result = grade(q, response)
      answers.set(quizId, [...(answers.get(quizId) ?? []).filter((a) => a.questionId !== questionId), result])
      return result
    },
    'quiz.finish': ({ quizId }) => {
      const quiz = quizzes.get(quizId) ?? fail('not_found', 'Quiz not found')
      const attempts = answers.get(quizId) ?? []
      const counted = quiz.questions.filter(
        (q) => !reported.has(q.id) || attempts.some((a) => a.questionId === q.id)
      )
      const scoreOf = (qs: Question[]): number =>
        qs.reduce((s, q) => s + (attempts.find((a) => a.questionId === q.id)?.score ?? 0), 0)
      const topics = [...new Set(counted.map((q) => q.topicId))]
      // Pages behind wrong answers, most-missed first.
      const misses = new Map<number, number>()
      for (const q of counted) {
        const a = attempts.find((x) => x.questionId === q.id)
        if (a?.correct) continue
        for (const p of q.sourcePages) misses.set(p, (misses.get(p) ?? 0) + 1 - (a?.score ?? 0))
      }
      const result: QuizResult = {
        quizId,
        score: scoreOf(counted),
        maxScore: counted.length,
        attempts,
        perTopic: topics.map((topicId) => {
          const qs = counted.filter((q) => q.topicId === topicId)
          return { topicId, score: scoreOf(qs), maxScore: qs.length }
        }),
        reviewPages: [...misses.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([p]) => p),
        finishedAt: now().toISOString()
      }
      results.unshift({ ...result, attempts: [...attempts] })
      return result
    },
    'quiz.history': ({ docId, limit }) => {
      getDoc(docId)
      return results.filter((r) => quizzes.get(r.quizId)?.docId === docId).slice(0, limit)
    },
    'quiz.reportQuestion': ({ questionId }) => {
      reported.add(questionId)
      return { ok: true }
    }
  }
}
