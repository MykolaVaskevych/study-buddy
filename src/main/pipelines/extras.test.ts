import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import type { Card } from '@shared/domain'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { ankiFile, toAnkiHtml } from './extras'
import { blendWeights } from './past-paper'
import { createHarness, type Harness } from './test-harness'

const card = (over: Partial<Card>): Card =>
  ({
    id: 'c1',
    docId: 'd1',
    topicId: null,
    type: 'basic',
    front: 'What is $P = IV$?',
    back: 'Power\nin **watts**',
    essential: true,
    sourcePages: [4],
    evidence: null,
    verification: 'verified',
    status: 'active',
    srs: {} as Card['srs'],
    createdAt: '2026-10-17T10:00:00.000Z',
    ...over
  }) as Card

describe('anki export', () => {
  it('converts markdown math to MathJax and escapes HTML', () => {
    expect(toAnkiHtml('a < b, $x^2$ and $$y$$\n**z**')).toBe('a &lt; b, \\(x^2\\) and \\[y\\]<br><b>z</b>')
  })

  it('writes Basic and Cloze rows with deck and tags columns', () => {
    const file = ankiFile(
      [card({}), card({ id: 'c2', type: 'cloze', front: '{{c1::Snell}} law', back: '' })],
      () => 'Study Buddy::Optics'
    )
    const lines = file.trim().split('\n')
    expect(lines.slice(0, 5)).toEqual([
      '#separator:tab',
      '#html:true',
      '#notetype column:1',
      '#deck column:2',
      '#tags column:5'
    ])
    expect(lines[5]?.split('\t')).toEqual([
      'Basic',
      'Study Buddy::Optics',
      'What is \\(P = IV\\)?',
      'Power<br>in <b>watts</b>',
      'p4 essential basic'
    ])
    expect(lines[6]?.startsWith('Cloze\tStudy Buddy::Optics\t{{c1::Snell}} law')).toBe(true)
  })
})

describe('blendWeights', () => {
  it('moves weight toward examined topics and keeps the sum at 1', () => {
    const next = blendWeights(
      new Map([
        ['a', 0.5],
        ['b', 0.5]
      ]),
      new Map([['a', 10]])
    )
    expect(next.get('a')).toBeCloseTo(0.8)
    expect(next.get('b')).toBeCloseTo(0.2)
  })
})

describe('chat, cheat sheet, anki, past papers through the handlers', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('streams a chat answer and finishes with citations', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const { requestId } = await harness.h['chat.ask']({
      docId,
      page: 2,
      question: 'What is total internal reflection?',
      history: [],
      mode: 'chat'
    })
    await vi.waitFor(() =>
      expect(harness.eventsOf('chat.done').some((e) => e.requestId === requestId)).toBe(true)
    )
    const done = harness.eventsOf('chat.done').find((e) => e.requestId === requestId)
    expect(done?.error).toBeNull()
    const text = harness
      .eventsOf('chat.delta')
      .filter((e) => e.requestId === requestId)
      .map((e) => e.text)
      .join('')
    expect(text.length).toBeGreaterThan(0)
  })

  it('builds a cheat sheet and an Anki file from indexed material', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const sheet = await harness.h['library.cheatSheet']({ docId })
    expect(sheet.sections.length).toBeGreaterThan(0)
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    const anki = await harness.h['cards.exportAnki']({ docId })
    expect(anki.count).toBeGreaterThan(0)
    expect(anki.content.split('\n').length).toBe(anki.count + 6)
  })

  it('recalibrates exam weights from a past paper and re-plans', async () => {
    const fake = createFakeProvider()
    const provider: LlmProvider = {
      ...fake,
      async generate<T>(req: GenerateRequest<T>) {
        if (req.task !== 'past_paper') return fake.generate(req)
        const data = {
          questions: [
            { summary: 'Power budget', marks: 10, topic_key: 't1' },
            { summary: '?', marks: 2, topic_key: 'nope' }
          ]
        }
        return { data: req.schema.parse(data), usage: (await fake.generate(req)).usage, model: 'fake' }
      }
    }
    harness = await createHarness({ provider })
    const docId = await harness.importIndexed()
    const result = await harness.h['plan.importPastPaper']({ docId, paths: [harness.fixture] })
    expect(result.questionsMapped).toBe(1)
    expect(result.unmapped).toBe(1)
    const first = result.changes[0]
    if (result.changes.length > 1) expect(first?.after).toBeGreaterThan(first?.before ?? 1)
    const sum = result.changes.reduce((s, c) => s + c.after, 0)
    expect(sum).toBeCloseTo(1)
  })
})
