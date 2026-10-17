import type { AttemptResult, Question, QuizResult, QuizSession } from '@shared/domain'
import { countedIds, initialRun, nextIndex, runReducer } from './run'
import type { RunAction, RunState } from './run'

const q = (id: string): Question => ({
  id,
  docId: 'd',
  topicId: null,
  type: 'mcq',
  stem: id,
  options: ['a', 'b'],
  answer: { type: 'mcq', correctIndex: 0 },
  explanation: '',
  optionRationales: null,
  difficulty: 2,
  sourcePages: [1],
  evidence: null,
  verification: 'verified',
  status: 'active',
  fromBook: false,
  createdAt: ''
})

const session: QuizSession = {
  id: 'quiz',
  docId: 'd',
  mode: 'page_check',
  scope: { kind: 'page', docId: 'd', page: 1 },
  questions: [q('a'), q('b'), q('c')],
  createdAt: '',
  timeLimit: null
}

const attempt = (questionId: string): AttemptResult => ({
  questionId,
  correct: true,
  score: 1,
  feedback: null,
  missingPoints: [],
  correctAnswer: 'A'
})

const run = (...actions: RunAction[]): RunState => actions.reduce(runReducer, initialRun(session))

describe('runReducer', () => {
  it('goes answering → checking → feedback → next question', () => {
    const s = run(
      { type: 'draft', questionId: 'a', draft: { type: 'mcq', index: 0 } },
      { type: 'check' },
      { type: 'answered', result: attempt('a') }
    )
    expect(s.phase).toBe('feedback')
    expect(s.results['a']?.correct).toBe(true)
    // Drafts are locked once marked.
    expect(runReducer(s, { type: 'draft', questionId: 'a', draft: { type: 'mcq', index: 1 } })).toBe(s)
    const next = runReducer(s, { type: 'goto', index: 1 })
    expect(next).toMatchObject({ index: 1, phase: 'answering' })
    // Going back shows the feedback again.
    expect(runReducer(next, { type: 'goto', index: 0 }).phase).toBe('feedback')
  })

  it('returns to answering with the error when marking fails', () => {
    const s = run({ type: 'check' }, { type: 'failed', message: 'offline' })
    expect(s).toMatchObject({ phase: 'answering', error: 'offline' })
  })

  it('keeps exam answers hidden: results during hand-in do not open feedback', () => {
    const s = run({ type: 'handIn' }, { type: 'answered', result: attempt('b') })
    expect(s.phase).toBe('handing_in')
    const done = runReducer(s, { type: 'finished', result: { quizId: 'quiz' } as QuizResult })
    expect(done.phase).toBe('done')
  })

  it('skips reported questions', () => {
    const s = run({ type: 'skip', questionId: 'b' })
    expect(nextIndex(s)).toBe(2)
    expect(countedIds(s)).toEqual(['a', 'c'])
    expect(nextIndex(runReducer(s, { type: 'goto', index: 2 }))).toBeNull()
  })

  it('starts done when there are no questions', () => {
    expect(initialRun({ ...session, questions: [] }).phase).toBe('done')
  })
})
