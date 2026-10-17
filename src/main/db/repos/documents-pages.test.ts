import type { PageIndexUpdate } from '../types'
import { newCard, newDocument, openTestDb, seedDocument } from '../test-helpers'

const indexUpdate = (overrides: Partial<PageIndexUpdate> = {}): PageIndexUpdate => ({
  page: 1,
  kind: 'content',
  teachable: true,
  summary: 'Chromatic dispersion broadens pulses',
  keyPoints: ['Dispersion grows with distance', 'Measured in ps/(nm·km)'],
  concepts: [{ term: 'dispersion', definition: 'pulse spreading', importance: 'core' }],
  formulas: [],
  exercises: [],
  examSignals: ['emphasis'],
  ...overrides
})

describe('DocumentRepo', () => {
  it('upsert dedupes by sha256', () => {
    const { db } = openTestDb()
    const first = db.documents.upsert(newDocument())
    const again = db.documents.upsert(newDocument({ title: 'Other title' }))
    expect(first.created).toBe(true)
    expect(again).toEqual({ id: first.id, created: false })
    expect(db.documents.get(first.id)?.title).toBe('Optical Networks')
    expect(db.documents.upsert(newDocument({ sha256: 'b'.repeat(64) })).created).toBe(true)
    expect(db.documents.list()).toHaveLength(2)
  })

  it('get returns the stored fields and a fresh index status', () => {
    const { db } = openTestDb()
    const id = seedDocument(db, {}, 3)
    expect(db.documents.get(id)).toEqual({
      id,
      title: 'Optical Networks',
      pageCount: 20,
      importedAt: '2026-10-17T10:00:00.000Z',
      lastOpenedAt: null,
      lastPage: 1,
      index: { state: 'none', indexedPages: 0, totalPages: 20 },
      cardsDue: 0,
      mastery: null,
      examDate: null,
      sha256: 'a'.repeat(64),
      storedPath: '/library/a.pdf',
      outline: [{ title: 'Intro', page: 1, children: [] }],
      language: null
    })
    expect(db.documents.get('missing')).toBeNull()
  })

  it('list computes cardsDue, mastery, examDate and indexed pages', () => {
    const { db, clock } = openTestDb()
    const id = seedDocument(db, {}, 4)
    db.pages.saveIndex(id, 1, indexUpdate())
    db.pages.saveIndex(id, 2, indexUpdate({ page: 2 }))

    db.cards.insertMany([newCard(id), newCard(id, { front: 'b' })], '2026-10-17T09:00:00.000Z')
    const [future] = db.cards.insertMany([newCard(id, { front: 'c' })], '2026-10-17T09:00:00.000Z')
    db.cards.saveReview(
      future!.id,
      { ...future!.srs, due: '2026-10-20T00:00:00.000Z', state: 'review' },
      { rating: 3, reviewedAt: '2026-10-17T09:30:00.000Z', elapsedMs: 1000 }
    )
    const [suspended] = db.cards.insertMany([newCard(id, { front: 'd' })], '2026-10-17T09:00:00.000Z')
    db.cards.update(suspended!.id, { status: 'suspended' })

    const [a, b] = db.topics.replaceAll(id, [
      { key: 'a', parentKey: null, title: 'A', pageStart: 1, pageEnd: 2, objectives: [], estimates: null },
      { key: 'b', parentKey: null, title: 'B', pageStart: 3, pageEnd: 4, objectives: [], estimates: null },
      { key: 'c', parentKey: null, title: 'C', pageStart: 3, pageEnd: 4, objectives: [], estimates: null }
    ])
    db.topics.addMasteryEvidence(a!.id, 3, 1) // Beta(4, 2) -> 2/3
    db.topics.addMasteryEvidence(b!.id, 0, 2) // Beta(1, 3) -> 1/4

    db.plans.save(
      {
        docId: id,
        input: {
          examDate: '2026-11-01T09:00:00.000Z',
          totalHours: 10,
          hoursPerDay: null,
          targetScore: 0.7,
          mode: 'max_score',
          format: 'mixed',
          overrides: []
        },
        result: {
          feasible: true,
          expectedScore: 0.7,
          targetScore: 0.7,
          budgetMinutes: 600,
          reserveMinutes: 150,
          plannedMinutes: 600,
          items: [],
          notes: []
        },
        schedule: { days: [] }
      },
      clock.now().toISOString()
    )
    db.documents.setIndexState(id, 'running')

    const [summary] = db.documents.list()
    expect(summary).toMatchObject({
      id,
      cardsDue: 2,
      examDate: '2026-11-01T09:00:00.000Z',
      index: { state: 'running', indexedPages: 2, totalPages: 20 }
    })
    expect(summary?.mastery).toBeCloseTo((2 / 3 + 1 / 4) / 2, 10)
  })

  it('orders the library by last opened, then newest import', () => {
    const { db, clock } = openTestDb()
    const old = seedDocument(db, { sha256: '1', title: 'old' })
    clock.advance(1000)
    const fresh = seedDocument(db, { sha256: '2', title: 'fresh' })
    clock.advance(1000)
    const opened = seedDocument(db, { sha256: '3', title: 'opened' })
    clock.advance(1000)
    db.documents.setLastPage(old, 7)
    expect(db.documents.list().map((d) => d.title)).toEqual(['old', 'opened', 'fresh'])
    expect(db.documents.get(old)).toMatchObject({ lastPage: 7, lastOpenedAt: '2026-10-17T10:00:03.000Z' })
    expect(opened).toBeTruthy()
    expect(fresh).toBeTruthy()
  })

  it('rename, setLanguage and setIndexState with an error', () => {
    const { db } = openTestDb()
    const id = seedDocument(db)
    db.documents.rename(id, 'Renamed')
    db.documents.setLanguage(id, 'de')
    db.documents.setIndexState(id, 'error', 'Rate limited too often')
    expect(db.documents.get(id)).toMatchObject({
      title: 'Renamed',
      language: 'de',
      index: { state: 'error', error: 'Rate limited too often' }
    })
    db.documents.setIndexState(id, 'done')
    expect(db.documents.get(id)?.index).toEqual({ state: 'done', indexedPages: 0, totalPages: 20 })
  })

  it('delete cascades to document data and its search index but keeps the usage ledger', () => {
    const { db, clock } = openTestDb()
    const id = seedDocument(db, {}, 3)
    db.cards.insertMany([newCard(id)], clock.now().toISOString())
    db.jobs.insert(
      {
        kind: 'index_chunk',
        docId: id,
        payload: {},
        priority: 0,
        dedupeKey: null,
        label: 'x',
        runAfter: null
      },
      clock.now().toISOString()
    )
    db.usage.record(
      {
        task: 'index',
        model: 'haiku',
        provider: 'fake',
        docId: id,
        usage: {
          inputTokens: 1,
          outputTokens: 1,
          cacheReadTokens: 0,
          cacheWriteTokens: 0,
          costUsd: 0.5,
          notional: false
        }
      },
      clock.now().toISOString()
    )
    expect(db.pages.search('text', id, 10)).toHaveLength(3)

    db.documents.delete(id)
    expect(db.documents.get(id)).toBeNull()
    expect(db.pages.notes(id, 1)).toBeNull()
    expect(db.pages.search('text', null, 10)).toEqual([])
    expect(db.cards.list({ kind: 'document', docId: id }, true)).toEqual([])
    expect(db.jobs.list(null, 10)).toEqual([])
    expect(db.usage.monthSpendUsd(clock.now().toISOString())).toBe(0.5)
  })
})

describe('PageRepo', () => {
  it('returns text, and notes with indexed=false and empty fields before indexing', () => {
    const { db } = openTestDb()
    const id = seedDocument(db, {}, 2)
    expect(db.pages.text(id, 2)).toBe('Page 2 text')
    expect(db.pages.text(id, 99)).toBe('')
    expect(db.pages.notes(id, 1)).toEqual({
      docId: id,
      page: 1,
      label: '1',
      indexed: false,
      kind: null,
      teachable: false,
      summary: null,
      keyPoints: [],
      concepts: [],
      formulas: [],
      exercises: [],
      examSignals: []
    })
    expect(db.pages.notes(id, 99)).toBeNull()
  })

  it('saveIndex stores the notes, marks the page indexed and refuses unknown pages', () => {
    const { db } = openTestDb()
    const id = seedDocument(db, {}, 5)
    db.pages.saveIndex(id, 4, indexUpdate({ page: 4 }))
    db.pages.saveIndex(id, 2, indexUpdate({ page: 2, kind: 'exercise' }))
    expect(db.pages.notes(id, 4)).toMatchObject({
      indexed: true,
      kind: 'content',
      teachable: true,
      keyPoints: ['Dispersion grows with distance', 'Measured in ps/(nm·km)'],
      examSignals: ['emphasis']
    })
    expect(db.pages.indexedPages(id)).toEqual([2, 4])
    expect(db.pages.notesInRange(id, 4, 2).map((n) => [n.page, n.indexed])).toEqual([
      [2, true],
      [3, false],
      [4, true]
    ])
    expect(() => db.pages.saveIndex(id, 42, indexUpdate({ page: 42 }))).toThrow(/not found/)
  })

  it('insertPages upserts text but keeps AI index data', () => {
    const { db } = openTestDb()
    const id = seedDocument(db, {}, 2)
    db.pages.saveIndex(id, 1, indexUpdate())
    db.pages.insertPages(id, [
      { page: 1, label: 'i', text: 'Re-extracted text', charCount: 17, hasTextLayer: true }
    ])
    expect(db.pages.text(id, 1)).toBe('Re-extracted text')
    expect(db.pages.notes(id, 1)).toMatchObject({ label: 'i', indexed: true })
    expect(db.pages.search('re-extracted', id, 5).map((h) => h.page)).toEqual([1])
    expect(db.pages.search('Page 1', id, 5).map((h) => h.page)).not.toContain(1)
  })

  it('setChunks replaces the chunk grid', () => {
    const { db } = openTestDb()
    const id = seedDocument(db)
    db.pages.setChunks(id, [
      { index: 1, startPage: 11, endPage: 20, path: '/c/1.pdf', bytes: 20 },
      { index: 0, startPage: 1, endPage: 10, path: '/c/0.pdf', bytes: 10 }
    ])
    expect(db.pages.chunks(id).map((c) => c.index)).toEqual([0, 1])
    db.pages.setChunks(id, [{ index: 0, startPage: 1, endPage: 20, path: '/c/all.pdf', bytes: 30 }])
    expect(db.pages.chunks(id)).toEqual([
      { index: 0, startPage: 1, endPage: 20, path: '/c/all.pdf', bytes: 30 }
    ])
  })
})

describe('PageRepo.search', () => {
  function searchFixture() {
    const ctx = openTestDb()
    const { db } = ctx
    const optics = seedDocument(db, { sha256: 'o', title: 'Optics' })
    db.pages.insertPages(optics, [
      { page: 1, label: null, text: 'Introduction to optical networks', charCount: 1, hasTextLayer: true },
      {
        page: 2,
        label: null,
        text: 'Attenuation in silica fiber is about 0.2 dB/km at 1550 nm',
        charCount: 1,
        hasTextLayer: true
      },
      { page: 3, label: null, text: 'Figure only', charCount: 1, hasTextLayer: false }
    ])
    db.pages.saveIndex(
      optics,
      3,
      indexUpdate({ page: 3, summary: 'Erbium-doped fiber amplifiers', keyPoints: ['EDFA gain band'] })
    )
    const networks = seedDocument(db, { sha256: 'n', title: 'Networks' })
    db.pages.insertPages(networks, [
      { page: 5, label: null, text: 'TCP/IP over fiber links', charCount: 1, hasTextLayer: true }
    ])
    return { ...ctx, optics, networks }
  }

  it('finds page text with snippets, ranked by bm25 (higher score first)', () => {
    const { db, optics } = searchFixture()
    const hits = db.pages.search('attenuation', optics, 10)
    expect(hits).toHaveLength(1)
    expect(hits[0]).toMatchObject({ docId: optics, page: 2 })
    expect(hits[0]?.snippet).toContain('Attenuation in silica fiber')
    expect(hits[0]?.score).toBeGreaterThan(0)
  })

  it('searches the AI summary and key points (plain text, not JSON)', () => {
    const { db, optics } = searchFixture()
    expect(db.pages.search('erbium', optics, 10).map((h) => h.page)).toEqual([3])
    const [hit] = db.pages.search('EDFA', optics, 10)
    expect(hit?.page).toBe(3)
    expect(hit?.snippet).not.toContain('[')
  })

  it('filters by document, or searches all documents when docId is null', () => {
    const { db, optics, networks } = searchFixture()
    expect(new Set(db.pages.search('fiber', null, 10).map((h) => h.docId))).toEqual(
      new Set([optics, networks])
    )
    expect(db.pages.search('fiber', networks, 10).map((h) => h.page)).toEqual([5])
    expect(db.pages.search('fiber', optics, 1)).toHaveLength(1)
  })

  it('matches prefixes, diacritic-insensitively, ANDing words', () => {
    const { db, optics } = searchFixture()
    expect(db.pages.search('atten', optics, 10).map((h) => h.page)).toEqual([2])
    expect(db.pages.search('silica 1550', optics, 10).map((h) => h.page)).toEqual([2])
    expect(db.pages.search('silica copper', optics, 10)).toEqual([])
    expect(db.pages.search('Introdúction', optics, 10).map((h) => h.page)).toEqual([1])
  })

  it.each([
    'AND',
    'fiber AND',
    'OR OR',
    'NEAR(fiber',
    '"unterminated',
    'text:fiber',
    '*',
    '^fiber',
    "'; drop table pages; --",
    '(((',
    '-fiber',
    'dB/km'
  ])('never throws on hostile input %j', (input) => {
    const { db } = searchFixture()
    expect(() => db.pages.search(input, null, 10)).not.toThrow()
    expect(Array.isArray(db.pages.search(input, null, 10))).toBe(true)
  })

  it('returns nothing for empty queries or a zero limit', () => {
    const { db } = searchFixture()
    expect(db.pages.search('   ', null, 10)).toEqual([])
    expect(db.pages.search('fiber', null, 0)).toEqual([])
  })
})
