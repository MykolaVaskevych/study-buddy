import { z } from 'zod'
import type { GenerateRequest, LlmProvider, StreamEvent } from '@shared/ai/provider'
import {
  cardsOutputSchema,
  gradeOutputSchema,
  indexChunkOutputSchema,
  questionsOutputSchema,
  topicMapOutputSchema,
  verifyOutputSchema
} from '@shared/ai/schemas'
import { buildCardsUser } from '../../prompts/cards'
import { buildGradeUser } from '../../prompts/grade'
import { buildIndexUser } from '../../prompts/index-chunk'
import { buildQuestionsUser } from '../../prompts/questions'
import { buildTopicMapUser } from '../../prompts/topic-map'
import { buildVerifyUser } from '../../prompts/verify'
import type { GenerationContext, IndexedPage } from '../../types'
import { createFakeProvider, sampleFromJsonSchema } from './provider'
import { mcqKey } from './keys'

const pageText = (p: number): string =>
  p === 13 ? '' : `Page ${p} explains attenuation of ${p} dB in long links.`
const chunk = { index: 1, startPage: 11, endPage: 15, path: '/lib/chunk-1.pdf', bytes: 1000 }

function note(page: number): IndexedPage {
  return {
    page,
    kind: 'content',
    teachable: true,
    summary: pageText(page),
    keyPoints: [],
    concepts: [{ term: `Term${page}`, definition: 'd', importance: 'core' }],
    formulas: [],
    exercises: [],
    examSignals: []
  }
}

const ctx: GenerationContext = {
  chunks: [chunk],
  pageFrom: 12,
  pageTo: 14,
  notes: [note(12), note(14)],
  pageText,
  language: 'auto'
}

const fake: LlmProvider = createFakeProvider({ checkFile: async () => undefined })

function req<T>(task: GenerateRequest<T>['task'], schema: z.ZodType<T>, text: string): GenerateRequest<T> {
  return {
    task,
    system: 's',
    parts: [
      { type: 'pdf', path: chunk.path },
      { type: 'text', text }
    ],
    schema,
    tier: 'smart'
  }
}

describe('fake provider: valid output for every schema, derived from the prompt', () => {
  it('index: one entry per manifest page, all inside the chunk', async () => {
    const { data } = await fake.generate(
      req('index', indexChunkOutputSchema, buildIndexUser(chunk, pageText))
    )
    expect(data.pages.map((p) => p.page)).toEqual([11, 12, 13, 14, 15])
    expect(data.pages[2]?.summary).toContain('image-only')
    expect(data.pages[1]?.summary).toBe(pageText(12))
  })

  it('topics: ranges from the digests', async () => {
    const text = buildTopicMapUser({
      title: 'Doc',
      outline: [],
      pages: [11, 12, 13].map((page) => ({
        page,
        kind: 'content' as const,
        summary: pageText(page),
        keyPoints: [],
        conceptTerms: [],
        formulaCount: 0,
        examSignals: [],
        charCount: 50,
        hasTextLayer: true
      })),
      language: 'en',
      firstPage: 1,
      lastPage: 13
    })
    const { data } = await fake.generate(req('topics', topicMapOutputSchema, text))
    expect(data.topics).toHaveLength(1)
    expect(data.topics[0]).toMatchObject({ page_start: 11, page_end: 13 })
  })

  it('cards: from the notes inside the focus range', async () => {
    const text = buildCardsUser(ctx, { count: 5, essentialsOnly: true, existingFronts: [] })
    const { data } = await fake.generate(req('cards', cardsOutputSchema, text))
    expect(data.cards.map((c) => c.source_pages)).toEqual([[12], [14]])
    expect(data.cards.every((c) => c.essential)).toBe(true)
  })

  it('questions: requested count and types, pages in range', async () => {
    const text = buildQuestionsUser(ctx, {
      count: 5,
      types: ['mcq', 'tf'],
      purpose: 'quiz',
      existingStems: []
    })
    const { data } = await fake.generate(req('questions', questionsOutputSchema, text))
    expect(data.questions).toHaveLength(5)
    expect(new Set(data.questions.map((q) => q.type))).toEqual(new Set(['mcq', 'tf']))
    expect(data.questions.every((q) => q.source_pages.every((p) => p >= 12 && p <= 14))).toBe(true)
  })

  it('verify: recomputes the generator keys from the stems', async () => {
    const stem = 'Which statement matches what page 12 says about Term12?'
    const text = buildVerifyUser({ from: 12, to: 14 }, [
      { id: 'q1', type: 'mcq', stem, options: ['a', 'b', 'c', 'd'] },
      { id: 'q2', type: 'numeric', stem: 'Compute $3 \\times 4$.', options: null },
      { id: 'q3', type: 'tf', stem: 'Something odd', options: null }
    ])
    const { data } = await fake.generate(req('verify', verifyOutputSchema, text))
    expect(data.answers).toEqual([
      expect.objectContaining({ id: 'q1', choice_index: mcqKey(stem, 4), answerable: true }),
      expect.objectContaining({ id: 'q2', numeric_value: 12, answerable: true }),
      expect.objectContaining({ id: 'q3', tf_answer: null, answerable: false })
    ])
  })

  it('grade: scores word overlap with the model answer', async () => {
    const text = buildGradeUser({
      stem: 'Why does light stay in the core?',
      modelAnswer: 'total internal reflection',
      rubric: ['total internal reflection'],
      response: 'Because of total internal reflection.'
    })
    const { data } = await fake.generate(req('grade', gradeOutputSchema, text))
    expect(data).toMatchObject({ score: 1, verdict: 'correct', missing_points: [] })
  })

  it('other tasks: a minimal value of the requested schema', async () => {
    const schema = z.strictObject({
      reply: z.string(),
      n: z.number().nullable(),
      tags: z.array(z.string()),
      ok: z.boolean()
    })
    const { data, model, usage } = await fake.generate(req('explain', schema, 'Explain page 3'))
    expect(data).toEqual({ reply: 'fake', n: 1, tags: [], ok: true })
    expect(model).toBe('fake')
    expect(usage).toMatchObject({ costUsd: 0, notional: true })
  })
})

describe('fake provider: failure modes like the real ones', () => {
  it('fails on a missing PDF part', async () => {
    const strict = createFakeProvider({
      checkFile: async () => {
        throw new Error('ENOENT')
      }
    })
    await expect(strict.generate(req('index', indexChunkOutputSchema, ''))).rejects.toMatchObject({
      kind: 'unknown',
      retryable: false
    })
  })

  it('fails on an aborted signal', async () => {
    await expect(
      fake.generate({ ...req('index', indexChunkOutputSchema, ''), signal: AbortSignal.abort() })
    ).rejects.toMatchObject({ kind: 'cancelled' })
  })

  it('fails with invalid_output when the task generator does not fit the schema', async () => {
    await expect(
      fake.generate(req('index', z.strictObject({ other: z.string() }), ''))
    ).rejects.toMatchObject({
      kind: 'invalid_output'
    })
  })

  it('streams words and a done event; health is ok', async () => {
    const events: StreamEvent[] = []
    for await (const e of fake.stream({
      task: 'chat',
      system: 's',
      parts: [{ type: 'text', text: 'hi' }],
      tier: 'smart'
    }))
      events.push(e)
    expect(events.at(-1)).toMatchObject({ type: 'done', model: 'fake' })
    expect(events.filter((e) => e.type === 'text').length).toBeGreaterThan(2)
    expect(await fake.health()).toMatchObject({ ok: true, provider: 'fake' })
  })
})

describe('sampleFromJsonSchema', () => {
  it('handles nullable unions and enums', () => {
    expect(
      sampleFromJsonSchema(
        z.toJSONSchema(z.strictObject({ a: z.string().nullable(), b: z.enum(['x', 'y']) }))
      )
    ).toEqual({
      a: 'fake',
      b: 'x'
    })
  })
})
