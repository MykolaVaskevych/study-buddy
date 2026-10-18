import { createHarness, type Harness } from './test-harness'

describe('overview, prepare, reset, annotations', () => {
  let harness: Harness
  afterEach(async () => harness.close())

  it('reports what is ready and prepares essentials decks for every topic', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    const before = await harness.h['library.overview']({ docId })
    expect(before.index.state).toBe('done')
    expect(before.topics.state).toBe('ready')
    expect(before.cards.total).toBe(0)

    const res = await harness.h['library.prepare']({ docId })
    expect(res.queued).toBeGreaterThan(0)
    await harness.waitIdle()
    const after = await harness.h['library.overview']({ docId })
    expect(after.cards.topicsCovered).toBe(after.cards.topicsTotal)
    expect(after.preparing).toBe(false)
    expect((await harness.h['library.prepare']({ docId })).queued).toBe(0)
  })

  it('prepare on an unread book reads it, builds the map, then makes cards', async () => {
    harness = await createHarness()
    const [doc] = await harness.h['library.import']({ paths: [harness.fixture] })
    await harness.h['index.pause']({ docId: doc!.id })
    await harness.waitIdle()
    await harness.h['library.prepare']({ docId: doc!.id })
    await harness.waitIdle()
    // The topic-map callback continues the request into card generation.
    await vi.waitFor(async () => {
      const o = await harness.h['library.overview']({ docId: doc!.id })
      expect(o.cards.total).toBeGreaterThan(0)
    })
  })

  it('resets the book progress and keeps the cards', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    await harness.h['cards.generate']({
      scope: { kind: 'document', docId },
      essentialsOnly: true,
      count: null
    })
    await harness.waitIdle()
    const [card] = await harness.h['cards.due']({ docId, limit: 1 })
    await harness.h['cards.review']({ cardId: card!.id, rating: 3, elapsedMs: 500 })
    await harness.h['reading.track']({ docId, page: 2, seconds: 40 })
    expect((await harness.h['library.overview']({ docId })).progress.reviews).toBe(1)

    const result = await harness.h['progress.reset']({ docId, topicId: null })
    expect(result.cards).toBeGreaterThan(0)
    const o = await harness.h['library.overview']({ docId })
    expect(o.progress).toMatchObject({ reviews: 0, pagesRead: 0 })
    expect(o.cards.total).toBeGreaterThan(0)
  })

  it('saves bookmarks and notes per page', async () => {
    harness = await createHarness()
    const docId = await harness.importIndexed()
    await harness.h['annotations.save']({ docId, page: 4, kind: 'bookmark', text: '' })
    await harness.h['annotations.save']({
      docId,
      page: 4,
      kind: 'note',
      text: 'Power budget: subtract losses'
    })
    expect((await harness.h['annotations.list']({ docId })).map((a) => a.kind)).toEqual(['bookmark', 'note'])
    await harness.h['annotations.delete']({ docId, page: 4, kind: 'bookmark' })
    expect(await harness.h['annotations.list']({ docId })).toHaveLength(1)
    await expect(
      harness.h['annotations.save']({ docId, page: 999, kind: 'note', text: 'x' })
    ).rejects.toThrow()
  })
})
