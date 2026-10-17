import { solvePlan } from '@shared/planner'
import type { PlanInput, PlanTopic, StudySession } from '@shared/planner'
import type { Topic } from '@shared/domain'
import {
  bestReachable,
  computePreview,
  groupNotes,
  hoursPerDayFor,
  neededMinutes,
  parseDuration,
  targetOutOfReach
} from './preview'
import { sessionTarget } from './sessions'
import { buildRows, changedLevels, groupRows, levelKey, skipSummary, sortRows } from './triage'

const topic = (id: string, over: Partial<PlanTopic> = {}): PlanTopic => ({
  id,
  title: id,
  examWeight: 0.25,
  coreFraction: 0.6,
  coreMinutes: 30,
  fullMinutes: 60,
  prerequisites: [],
  mastery: null,
  minutesSpent: 0,
  ...over
})

const meta = (id: string, order: number, parentId: string | null, pageStart: number): Topic => ({
  id,
  docId: 'doc',
  parentId,
  order,
  title: id.toUpperCase(),
  pageStart,
  pageEnd: pageStart + 4,
  objectives: [],
  estimates: {
    difficulty: 3,
    examWeight: 0.25,
    examWeightReasons: [],
    coreFraction: 0.6,
    coreMinutes: 30,
    fullMinutes: 60,
    prerequisites: []
  },
  mastery: null
})

const input = (over: Partial<PlanInput> = {}): PlanInput => ({
  examDate: null,
  totalHours: 2,
  hoursPerDay: null,
  targetScore: 0.7,
  mode: 'max_score',
  format: 'written',
  overrides: [],
  reserveFraction: 0,
  ...over
})

/** Four topics; "osnr" is long, hard to finish and worth little, so a tight budget skips it. */
const topics = [
  topic('basics', { examWeight: 0.3, coreMinutes: 15, fullMinutes: 30 }),
  topic('budget', { examWeight: 0.35, prerequisites: ['basics'] }),
  topic('dispersion', { examWeight: 0.29, prerequisites: ['basics'] }),
  topic('osnr', { examWeight: 0.06, coreFraction: 0.3, coreMinutes: 90, fullMinutes: 240 })
]
const metas = [meta('chapter', 0, null, 1), meta('basics', 1, 'chapter', 1), meta('budget', 2, 'chapter', 10)]

describe('note parsing', () => {
  it('reads durations written by formatMinutes', () => {
    expect(parseDuration('13 h 15 m')).toBe(795)
    expect(parseDuration('40 m')).toBe(40)
    expect(parseDuration('3 h')).toBe(180)
    expect(parseDuration('soon')).toBeNull()
    expect(parseDuration('')).toBeNull()
  })

  it('finds the time the solver says would reach the target', () => {
    const plan = solvePlan(topics, input({ totalHours: 1, targetScore: 0.8 }))
    expect(plan.feasible).toBe(false)
    const needed = neededMinutes(plan.notes)
    expect(needed).not.toBeNull()
    // The suggestion really is enough.
    const fixed = solvePlan(topics, input({ totalHours: (needed ?? 0) / 60, targetScore: 0.8 }))
    expect(fixed.feasible).toBe(true)
    expect(neededMinutes(['Expected ~80 %, at or above your 70 % target.'])).toBeNull()
  })

  it('recognises a target above what studying everything gives, and the best that is possible', () => {
    const plan = solvePlan(topics, input({ totalHours: 1, targetScore: 0.95 }))
    expect(targetOutOfReach(plan.notes)).toBe(true)
    expect(neededMinutes(plan.notes)).toBeNull()
    expect(bestReachable(topics, input())).toBeCloseTo(0.9, 5)
  })

  it('sorts notes into outcome, budget and the rest', () => {
    const groups = groupNotes([
      'Budget: 8 h.',
      'Kept 1 h 36 m (20 %) for page checks, spaced review and mock exams; 6 h 24 m for learning.',
      'Exam weights added up to 120 %; rescaled to 100 %.',
      'Target 75 % not reachable in 8 h; best is ~60 %. About 13 h 30 m would get there.'
    ])
    expect(groups.outcome).toMatch(/^Target 75 %/)
    expect(groups.budget).toHaveLength(2)
    expect(groups.other).toEqual(['Exam weights added up to 120 %; rescaled to 100 %.'])
  })

  it('turns needed minutes into whole quarter hours per day, never less than needed', () => {
    expect(hoursPerDayFor(795, 7)).toBe(2)
    expect(hoursPerDayFor(90, 4)).toBe(0.5)
    expect(hoursPerDayFor(60, 0)).toBe(1)
  })
})

describe('triage rows', () => {
  const tight = input({ totalHours: 2 })
  const preview = computePreview(topics, tight, '2026-10-17')
  const rows = buildRows(topics, metas, tight, preview.result)
  const row = (id: string) => rows.find((r) => r.id === id)!

  it('joins the solver decision with pages, chapter, difficulty and dependents', () => {
    expect(row('osnr').item.level).toBe('skip')
    expect(row('basics')).toMatchObject({
      pageStart: 1,
      difficulty: 3,
      chapter: { id: 'chapter', title: 'CHAPTER' }
    })
    expect(row('basics').requiredBy).toEqual(expect.arrayContaining(['budget']))
    expect(row('osnr').chapter).toBeNull()
    expect(preview.schedule.days.length).toBeGreaterThan(0)
  })

  it('sorts by value for time by default and keeps book order on ties', () => {
    expect(sortRows(rows, 'value').at(-1)?.id).toBe('osnr')
    expect(sortRows(rows, 'weight')[0]?.id).toBe('budget')
    expect(sortRows(rows, 'time')[0]?.id).toBe('osnr')
    expect(sortRows(rows, 'page').map((r) => r.id)).toEqual(['basics', 'budget', 'dispersion', 'osnr'])
  })

  it('groups by chapter in book order, topics without one standing alone', () => {
    const groups = groupRows(sortRows(rows, 'value'), true)
    expect(groups.map((g) => g.key)).toEqual(['chapter:chapter', 'topic:dispersion', 'topic:osnr'])
    expect(groupRows(rows, false)).toHaveLength(1)
    expect(groupRows([], false)).toEqual([])
  })

  it('reports what the skipped topics trade away', () => {
    const s = skipSummary(rows)
    expect(s.count).toBe(1)
    expect(s.minutes).toBe(240)
    expect(s.gain).toBeCloseTo(0.06 * 0.9, 5)
  })

  it('reflects pins and weight overrides', () => {
    const pinned = input({
      totalHours: 2,
      overrides: [{ topicId: 'budget', level: 'skip', examWeight: 0.5 }]
    })
    const result = solvePlan(topics, pinned)
    const r = buildRows(topics, metas, pinned, result).find((x) => x.id === 'budget')!
    expect(r).toMatchObject({ pin: 'skip', weight: 0.5, estimatedWeight: 0.35, weightOverridden: true })
    expect(r.item.reason).toBe('You set this')
  })

  it('finds the topics whose level changed between two solves', () => {
    const before = levelKey(preview.result.items)
    const roomy = computePreview(topics, input({ totalHours: 10 }), '2026-10-17')
    const changed = changedLevels(before, levelKey(roomy.result.items))
    expect(changed.has('osnr')).toBe(true)
    expect(changedLevels('', before).size).toBe(0)
    expect(changedLevels(before, before).size).toBe(0)
  })
})

describe('session targets', () => {
  const session = (kind: StudySession['kind'], topicId: string | null = 't'): StudySession => ({
    kind,
    topicId,
    minutes: 30,
    level: null,
    label: kind
  })
  const pageOf = (id: string) => (id === 't' ? 31 : null)

  it('learn and check open the book at the topic, review and mocks go to their screens', () => {
    expect(sessionTarget(session('learn'), 'doc 1', pageOf)).toEqual({
      to: '/book/doc%201?page=31',
      studyTab: null
    })
    expect(sessionTarget(session('check'), 'd', pageOf)).toEqual({ to: '/book/d?page=31', studyTab: 'test' })
    expect(sessionTarget(session('learn', 'unknown'), 'd', pageOf).to).toBe('/book/d')
    expect(sessionTarget(session('review', null), 'd', pageOf).to).toBe('/review')
    expect(sessionTarget(session('mock', null), 'd', pageOf).to).toBe('/book/d/quiz?mode=mock')
  })
})
