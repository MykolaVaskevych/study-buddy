import type { GenerateRequest, LlmProvider } from '@shared/ai/provider'
import type { IndexChunkOutput } from '@shared/ai/schemas'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { createHarness, type Harness } from './test-harness'

describe('index pass retry', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('re-indexes pages the first pass skipped with one focus-chunk retry', async () => {
    const fake = createFakeProvider()
    let dropped = false
    const provider: LlmProvider = {
      ...fake,
      async generate<T>(req: GenerateRequest<T>) {
        const res = await fake.generate(req)
        if (req.task !== 'index' || dropped) return res
        const out = res.data as unknown as IndexChunkOutput
        if (!out.pages.some((p) => p.page === 2)) return res
        dropped = true
        return { ...res, data: { ...out, pages: out.pages.filter((p) => p.page !== 2) } as unknown as T }
      }
    }
    harness = await createHarness({ provider })
    const docId = await harness.importIndexed()
    await harness.waitIdle()
    expect(dropped).toBe(true)
    expect(harness.db.pages.indexedPages(docId)).toContain(2)
    const jobs = await harness.h['jobs.list']({ docId })
    expect(jobs.some((j) => j.label.startsWith('Indexing skipped pages') && j.state === 'done')).toBe(true)
  })
})
