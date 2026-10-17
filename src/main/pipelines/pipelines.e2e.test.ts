import { join } from 'node:path'
import { runSmoke, writeSmokePdf } from '../app/smoke'
import { localDate } from './dates'
import { correctResponse, createHarness, wrongResponse, type Harness } from './test-harness'

let t: Harness
afterEach(async () => {
  await t.close()
})

describe('pipelines end to end (fixture PDF, fake provider, real modules)', () => {
  it('import → index → topics → cards → review → page check → quiz → plan → usage', async () => {
    t = await createHarness()
    const { h, db } = t

    // Import through the native picker (paths: null), which auto-starts the index pass.
    const [summary] = await h['library.import']({ paths: null })
    expect(summary).toMatchObject({ title: 'Fixture Course: Optical Links', pageCount: 12 })
    const docId = summary?.id ?? ''
    expect(t.eventsOf('library.changed')).toContainEqual({ docId })
    expect(db.pages.chunks(docId).map((c) => [c.startPage, c.endPage])).toEqual([
      [1, 10],
      [11, 12]
    ])
    // Starting again while it runs is harmless: jobs are de-duplicated per chunk.
    await h['index.start']({ docId })
    await t.waitIdle()

    expect(await h['index.status']({ docId })).toEqual({ state: 'done', indexedPages: 12, totalPages: 12 })
    expect(t.eventsOf('index.progress').at(-1)?.status.state).toBe('done')
    expect(db.documents.get(docId)?.language).toBe('en')
    expect((await h['library.pageNotes']({ docId, page: 1 })).teachable).toBe(false)

    const topics = await h['topics.list']({ docId })
    expect(topics.map((tp) => [tp.pageStart, tp.pageEnd])).toEqual([
      [1, 5],
      [6, 10],
      [11, 12]
    ])
    const first = topics[0]
    if (!first) throw new Error('no topic')
    expect(first.estimates?.coreMinutes).toBeGreaterThan(0)

    // Flashcards for a topic: background job, cards land in the deck with their topic.
    const { jobId } = await h['cards.generate']({
      scope: { kind: 'topic', docId, topicId: first.id },
      essentialsOnly: false,
      count: null
    })
    expect((await t.queue.wait(jobId)).state).toBe('done')
    const cards = await h['cards.list']({
      scope: { kind: 'topic', docId, topicId: first.id },
      includeInactive: false
    })
    expect(cards.length).toBeGreaterThan(0)
    expect(cards.every((c) => c.topicId === first.id)).toBe(true)
    expect(t.eventsOf('cards.changed')).toContainEqual({ docId })

    const due = await h['cards.due']({ docId, limit: 100 })
    expect(due.map((c) => c.id)).toEqual(cards.map((c) => c.id))
    const card = cards[0]
    if (!card) throw new Error('no card')
    const reviewed = await h['cards.review']({ cardId: card.id, rating: 3, elapsedMs: 4000 })
    expect(Date.parse(reviewed.srs.due)).toBeGreaterThan(t.clock.now().getTime())
    expect((await h['cards.due']({ docId, limit: 100 })).map((c) => c.id)).not.toContain(card.id)
    expect(db.topics.mastery(first.id)).toEqual({ alpha: 2, beta: 1 })

    // "Test me" on page 2: generated on demand, then answered (first one wrong).
    const check = await h['quiz.pageCheck']({ docId, page: 2 })
    expect(check.mode).toBe('page_check')
    expect(check.questions.length).toBeGreaterThanOrEqual(3)
    expect(check.questions.every((q) => q.sourcePages.includes(2))).toBe(true)
    let wrong = 0
    for (const [i, q] of check.questions.entries()) {
      const response = i === 0 ? wrongResponse(q) : correctResponse(q)
      const result = await h['quiz.answer']({ quizId: check.id, questionId: q.id, response, elapsedMs: 1000 })
      if (i === 0) expect(result.correct).toBe(false)
      else expect(result.score).toBeGreaterThanOrEqual(0.5)
      if (!result.correct) wrong++
    }
    const result = await h['quiz.finish']({ quizId: check.id })
    expect(result.maxScore).toBe(check.questions.length)
    expect(result.score).toBeLessThan(result.maxScore)
    expect(result.attempts).toHaveLength(check.questions.length)
    expect(result.reviewPages[0]).toBe(2)
    expect(wrong).toBeGreaterThan(0)
    expect(await h['quiz.history']({ docId, limit: 10 })).toEqual([result])

    // A week later the answered questions are fresh again: reused, no new generation.
    const checkJobs = (): number => db.jobs.list(docId, 1000).filter((j) => j.kind === 'page_check').length
    const jobsBefore = checkJobs()
    t.clock.advance(8 * 24 * 60 * 60 * 1000)
    const later = await h['quiz.pageCheck']({ docId, page: 2 })
    expect(later.questions.map((q) => q.id).sort()).toEqual(check.questions.map((q) => q.id).sort())
    expect(checkJobs()).toBe(jobsBefore)

    // Planner.
    const planTopics = await h['plan.topics']({ docId })
    expect(planTopics.map((p) => p.id)).toEqual(topics.map((tp) => tp.id))
    expect(planTopics[0]?.mastery).not.toBeNull()
    const plan = await h['plan.save']({
      docId,
      input: {
        examDate: '2026-10-24',
        totalHours: null,
        hoursPerDay: 2,
        targetScore: 0.7,
        mode: 'max_score',
        format: 'mixed',
        overrides: []
      }
    })
    expect(plan.result.items).toHaveLength(3)
    expect(await h['plan.get']({ docId })).toEqual(plan)
    const today = await h['plan.today']({ docId })
    expect(today?.date.slice(0, 10)).toBe(localDate(t.clock.now()))
    expect((await h['library.get']({ docId })).examDate).toBe('2026-10-24')

    // Every AI call is in the ledger.
    const usage = await h['usage.summary']({})
    const tasks = usage.byTask.map((u) => u.task)
    for (const task of ['index', 'topics', 'cards', 'page_check', 'verify', 'grade'])
      expect(tasks).toContain(task)
    expect(usage.notional).toBe(true)

    // Job events reached the renderer.
    expect(t.eventsOf('jobs.changed').some((j) => j.kind === 'index_chunk' && j.state === 'done')).toBe(true)
    expect((await h['jobs.list']({ docId })).length).toBeGreaterThan(0)
  })

  it('passes the app --smoke flow (src/main/app/smoke.ts) driven through the real handlers', async () => {
    t = await createHarness()
    const pdfPath = await writeSmokePdf(join(t.libraryDir, '..', 'smoke'))
    const lines: string[] = []
    const log = {
      info: (m: string) => lines.push(m),
      warn: (m: string) => lines.push(m),
      error: (m: string) => lines.push(m)
    }
    const report = await runSmoke(t.h, { pdfPath, log, timeoutMs: 15_000, pollMs: 5, now: t.clock.now })
    expect(report.steps.map((s) => s.name)).toContain('usage.summary')
  })
})
