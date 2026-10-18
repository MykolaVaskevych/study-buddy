import { createHarness, type Harness } from './test-harness'

describe('study book lessons', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('writes a chapter per topic, skips written ones, and shows up in the overview', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const first = await harness.h['lessons.generate']({ docId, topicId: null })
    expect(first.queued).toBeGreaterThan(0)
    await harness.waitIdle()
    const lessons = await harness.h['lessons.list']({ docId })
    expect(lessons).toHaveLength(first.queued)
    expect(lessons[0]?.sections.length).toBeGreaterThan(0)
    expect((await harness.h['lessons.generate']({ docId, topicId: null })).queued).toBe(0)
    const o = await harness.h['library.overview']({ docId })
    expect(o.studyBook.written).toBe(o.studyBook.topicsTotal)
  })

  it('refuses before the course map exists', async () => {
    harness = await createHarness()
    const [doc] = await harness.h['library.import']({ paths: [harness.fixture] })
    await harness.h['index.pause']({ docId: doc!.id })
    await harness.waitIdle()
    await expect(harness.h['lessons.generate']({ docId: doc!.id, topicId: null })).rejects.toThrow(
      /course map/
    )
  })
})
