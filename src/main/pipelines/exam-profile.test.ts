import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import type { CardsOutput } from '@shared/ai/schemas'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { createHarness, type Harness } from './test-harness'

describe('exam profile in the pipelines', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('asks for the exam profile before preparing, then follows it', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const gated = await harness.h['library.prepare']({ docId })
    expect(gated).toMatchObject({ needsProfile: true, queued: 0 })

    const saved = await harness.h['exam.saveProfile']({
      docId,
      formats: { mcq: 3, written: 1, numeric: 0 },
      formulas: 'none',
      formulaSheet: false
    })
    expect(saved).toMatchObject({ source: 'user', formats: { mcq: 0.75, written: 0.25, numeric: 0 } })
    expect((await harness.h['library.prepare']({ docId })).needsProfile).toBe(false)
  })

  it('sends the profile to the card prompt and rebuild suspends formula cards', async () => {
    const fake = createFakeProvider()
    const prompts: string[] = []
    const provider: LlmProvider = {
      ...fake,
      async generate<T>(req: GenerateRequest<T>) {
        const text = req.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
        if (req.task === 'cards') {
          prompts.push(text)
          const page = Number(/Focus pages: (\d+)/.exec(text)?.[1] ?? 2)
          const data: CardsOutput = {
            cards: [
              {
                type: 'formula',
                front: `Formula on ${page}?`,
                back: 'x',
                essential: true,
                source_pages: [page],
                evidence: 'x'
              }
            ]
          }
          return { data: data as unknown as T, usage: (await fake.generate(req)).usage, model: 'fake' }
        }
        return fake.generate(req)
      }
    }
    harness = await createHarness({ provider })
    const docId = await harness.importIndexed()
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    await harness.h['exam.saveProfile']({
      docId,
      formats: { mcq: 1, written: 0, numeric: 0 },
      formulas: 'none',
      formulaSheet: false
    })
    const res = await harness.h['cards.rebuildForExam']({ docId })
    expect(res.suspended).toBeGreaterThan(0)
    expect(res.queued).toBeGreaterThan(0)
    await harness.waitIdle()
    expect(prompts.at(-1)).toMatch(/no formula cards/)
  })

  it('a wrong answer becomes a "My mistakes" card', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const session = await harness.h['quiz.pageCheck']({ docId, page: 2 })
    const mcq = session.questions.find((q) => q.answer.type === 'mcq')
    if (!mcq || mcq.answer.type !== 'mcq') throw new Error('fixture has no mcq')
    const wrong = (mcq.answer.correctIndex + 1) % (mcq.options?.length ?? 2)
    await harness.h['quiz.answer']({
      quizId: session.id,
      questionId: mcq.id,
      response: { type: 'mcq', index: wrong },
      elapsedMs: 100
    })
    const cards = await harness.h['cards.list']({
      scope: { kind: 'document', docId },
      includeInactive: false
    })
    const mistake = cards.find((c) => c.type === 'mistake')
    expect(mistake?.front).toContain(mcq.stem)
    expect(mistake?.back).toContain(mcq.explanation)
  })
})
