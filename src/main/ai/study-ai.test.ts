import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import type { Question } from '@shared/domain'
import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import type { VerifyOutput } from '@shared/ai/schemas'
import { makeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import type { ChunkInfo } from '../library/types'
import { createFakeProvider } from './providers/fake/provider'
import { createStudyAi } from './study-ai'
import type { GenerationContext, IndexedPage, PageDigest } from './types'

/** Text layer of fixture pages 1-5 as the library would extract it (page 3 is image-only). */
const FIXTURE_TEXT: Record<number, string> = {
  1: 'Fixture Course: Optical Links Study notes for automated tests',
  2: 'Total internal reflection Light stays inside the fibre core because the core refractive index n1 is higher than the cladding index n2. Rays hitting the boundary above the critical angle are reflected. Typical attenuation of single-mode fibre is 0.2 dB/km at 1550 nm.',
  3: '',
  4: 'Power budget P_rx = P_tx - alpha * L - connector losses P_rx: received power in dBm. P_tx: launch power in dBm. alpha: fibre attenuation in dB/km. L: link length in km.',
  5: 'Try it A 50 km link uses fibre with 0.2 dB/km attenuation. What is the fibre loss? Answer: 0.2 dB/km x 50 km = 10 dB.'
}
const pageText = (p: number): string => FIXTURE_TEXT[p] ?? ''

let dir: string
let chunk: ChunkInfo

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'sb-ai-'))
  const source = await PDFDocument.load(await makeFixturePdf())
  const out = await PDFDocument.create()
  for (const page of await out.copyPages(source, [0, 1, 2, 3, 4])) out.addPage(page)
  const bytes = await out.save()
  chunk = { index: 0, startPage: 1, endPage: 5, path: join(dir, 'chunk-0.pdf'), bytes: bytes.length }
  await writeFile(chunk.path, bytes)
})

afterAll(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function indexed(): Promise<IndexedPage[]> {
  const ai = createStudyAi(createFakeProvider())
  return (await ai.indexChunk({ chunk, pageText })).value.pages
}

function context(notes: IndexedPage[], from = 2, to = 5): GenerationContext {
  return {
    chunks: [chunk],
    pageFrom: from,
    pageTo: to,
    notes: notes.filter((n) => n.page >= from && n.page <= to),
    pageText,
    language: 'auto',
    exam: null
  }
}

/** Wraps a provider and rewrites the blind answers, to simulate a verifier that disagrees. */
function tamperVerify(inner: LlmProvider, edit: (out: VerifyOutput) => VerifyOutput): LlmProvider {
  return {
    ...inner,
    async generate<T>(req: GenerateRequest<T>) {
      const res = await inner.generate(req)
      if (req.task !== 'verify') return res
      const parsed = req.schema.parse(edit(res.data as unknown as VerifyOutput))
      return { ...res, data: parsed }
    }
  }
}

describe('StudyAi with the fake provider', () => {
  it('indexes a chunk: every page in range, title not teachable, usage recorded', async () => {
    const ai = createStudyAi(createFakeProvider())
    const res = await ai.indexChunk({ chunk, pageText })
    expect(res.value.language).toBe('en')
    expect(res.value.missingPages).toEqual([])
    expect(res.value.pages.map((p) => p.page)).toEqual([1, 2, 3, 4, 5])
    expect(res.value.pages[0]).toMatchObject({ kind: 'title', teachable: false })
    expect(res.value.pages[2]?.summary).toMatch(/image-only/)
    expect(res.usage).toEqual([
      { task: 'index', model: 'fake', usage: expect.objectContaining({ costUsd: 0 }) }
    ])
  })

  it('generates questions with grounding and a blind verification pass', async () => {
    const ai = createStudyAi(createFakeProvider())
    const res = await ai.generateQuestions(context(await indexed()), {
      count: 8,
      types: null,
      purpose: 'quiz',
      existingStems: [],
      verify: true
    })
    expect(res.usage.map((u) => u.task)).toEqual(['questions', 'verify'])
    expect(res.value).toHaveLength(8)
    for (const q of res.value) {
      expect(q.sourcePages.every((p) => p >= 2 && p <= 5)).toBe(true)
      expect(q.verification).toBe(q.sourcePages.includes(3) ? 'not_applicable' : 'verified')
    }
    expect(new Set(res.value.map((q) => q.type))).toEqual(new Set(['mcq', 'multi', 'tf', 'short', 'numeric']))
  })

  it('drops questions the blind verifier contradicts or cannot answer', async () => {
    const provider = tamperVerify(createFakeProvider(), (out) => ({
      answers: out.answers.map((a) =>
        a.choice_index !== null
          ? { ...a, choice_index: (a.choice_index + 1) % 4 }
          : a.tf_answer !== null
            ? { ...a, answerable: false }
            : a
      )
    }))
    const res = await createStudyAi(provider).generateQuestions(context(await indexed()), {
      count: 5,
      types: null,
      purpose: 'page_check',
      existingStems: [],
      verify: true
    })
    expect(res.usage.map((u) => u.task)).toEqual(['page_check', 'verify'])
    expect(res.value.map((q) => q.type).sort()).toEqual(['multi', 'numeric', 'short'])
  })

  it('skips verification when not asked, and de-duplicates against existing stems', async () => {
    const ai = createStudyAi(createFakeProvider())
    const ctx = context(await indexed(), 2, 2)
    const first = await ai.generateQuestions(ctx, {
      count: 1,
      types: ['mcq'],
      purpose: 'quiz',
      existingStems: [],
      verify: false
    })
    expect(first.usage.map((u) => u.task)).toEqual(['questions'])
    const again = await ai.generateQuestions(ctx, {
      count: 1,
      types: ['mcq'],
      purpose: 'quiz',
      existingStems: first.value.map((q) => q.stem),
      verify: false
    })
    expect(again.value).toEqual([])
  })

  it('generates grounded, de-duplicated cards', async () => {
    const ai = createStudyAi(createFakeProvider())
    const ctx = context(await indexed())
    const res = await ai.generateCards(ctx, { count: 10, essentialsOnly: false, existingFronts: [] })
    expect(res.value.map((c) => c.sourcePages[0])).toEqual([2, 3, 4, 5])
    expect(res.value.map((c) => c.verification)).toEqual([
      'verified',
      'not_applicable',
      'verified',
      'verified'
    ])
    const deduped = await ai.generateCards(ctx, {
      count: 10,
      essentialsOnly: true,
      existingFronts: [res.value[0]!.front]
    })
    expect(deduped.value).toHaveLength(3)
    expect(deduped.value.every((c) => c.essential)).toBe(true)
  })

  it('makes no call for a zero count and rejects a range without chunks', async () => {
    const ai = createStudyAi(createFakeProvider())
    expect(
      await ai.generateCards(context([]), { count: 0, essentialsOnly: false, existingFronts: [] })
    ).toEqual({
      value: [],
      usage: []
    })
    await expect(
      ai.generateCards(context([], 4, 9), { count: 3, essentialsOnly: false, existingFronts: [] })
    ).rejects.toMatchObject({ kind: 'unknown', retryable: false })
  })

  it('builds a normalised topic map from page digests', async () => {
    const digests: PageDigest[] = (await indexed()).map((p) => ({
      page: p.page,
      kind: p.kind,
      summary: p.summary,
      keyPoints: p.keyPoints,
      conceptTerms: p.concepts.map((c) => c.term),
      formulaCount: p.formulas.length,
      examSignals: p.examSignals,
      charCount: pageText(p.page).length,
      hasTextLayer: pageText(p.page) !== ''
    }))
    const res = await createStudyAi(createFakeProvider()).buildTopicMap({
      title: 'Fixture',
      outline: [],
      pages: digests,
      language: 'en'
    })
    expect(res.value).toHaveLength(1)
    expect(res.value[0]).toMatchObject({ pageStart: 1, pageEnd: 5, examWeight: 1 })
    expect(res.usage.map((u) => u.task)).toEqual(['topics'])
    expect(
      await createStudyAi(createFakeProvider()).buildTopicMap({
        title: 'x',
        outline: [],
        pages: [],
        language: 'en'
      })
    ).toEqual({
      value: [],
      usage: []
    })
  })

  it('grades short answers and short-circuits empty ones', async () => {
    const ai = createStudyAi(createFakeProvider())
    const question: Question = {
      id: 'q',
      docId: 'd',
      topicId: null,
      type: 'short',
      stem: 'Why does light stay in the core?',
      options: null,
      answer: {
        type: 'short',
        modelAnswer: 'total internal reflection',
        rubric: ['names total internal reflection']
      },
      explanation: '',
      optionRationales: null,
      difficulty: 2,
      sourcePages: [2],
      evidence: null,
      verification: 'verified',
      status: 'active',
      fromBook: false,
      createdAt: '2026-10-17T00:00:00.000Z'
    }
    const good = await ai.gradeShortAnswer({ question, response: 'Because of total internal reflection.' })
    expect(good.value).toMatchObject({ score: 1, verdict: 'correct' })
    expect(good.usage).toHaveLength(1)
    const empty = await ai.gradeShortAnswer({ question, response: '  ' })
    expect(empty).toEqual({
      value: {
        score: 0,
        verdict: 'incorrect',
        feedback: 'No answer was given.',
        missingPoints: ['names total internal reflection']
      },
      usage: []
    })
    await expect(
      ai.gradeShortAnswer({ question: { ...question, answer: { type: 'tf', value: true } }, response: 'yes' })
    ).rejects.toMatchObject({ kind: 'unknown' })
  })
})
