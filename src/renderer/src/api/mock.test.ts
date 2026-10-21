import { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { createElement } from 'react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { setBridge } from './client'
import { useApiEvents, useLibrary, useRateLimit } from './hooks'
import { contractChannels, createMockApi } from './mock'

const mock = () => createMockApi({ latency: [0, 0], simulate: false })

describe('mock pdf source', () => {
  it('generates the 146-page Optical Networks deck as bytes for pdf.js', async () => {
    const { PDFDocument } = await import('pdf-lib')
    const source = await mock().pdfSource('optical-networks')
    expect(source.kind).toBe('data')
    if (source.kind !== 'data') return
    const pdf = await PDFDocument.load(source.data)
    expect(pdf.getPageCount()).toBe(146)
  })
})

describe('mock api', () => {
  it('answers every channel of the contract', async () => {
    const api = mock()
    const docId = 'optical-networks'
    const inputs: Record<string, unknown> = {
      'library.import': { paths: ['x.pdf'] },
      'library.search': { query: 'power', docId: null, limit: 5 },
      'library.rename': { docId, title: 'Renamed' },
      'library.delete': { docId: 'probability-notes' },
      'library.setLastPage': { docId, page: 3 },
      'library.pageNotes': { docId, page: 3 },
      'index.focus': { docId, page: 3 },
      'cards.generate': { scope: { kind: 'document', docId }, essentialsOnly: true, count: null },
      'cards.list': { scope: { kind: 'document', docId }, includeInactive: false },
      'cards.due': { docId, limit: 10 },
      'cards.review': { cardId: `${docId}-card-1`, rating: 3, elapsedMs: 1000 },
      'cards.update': { cardId: `${docId}-card-1`, front: 'f', back: 'b' },
      'cards.setStatus': { cardId: `${docId}-card-1`, status: 'active' },
      'cards.stats': { docId },
      'cram.plan': { docId, cards: 10 },
      'quiz.create': {
        scope: { kind: 'page', docId, page: 40 },
        mode: 'topic',
        count: 2,
        types: null,
        timeLimit: null
      },
      'quiz.pageCheck': { docId, page: 40 },
      'quiz.history': { docId, limit: 5 },
      'quiz.reportQuestion': { questionId: 'q', reason: 'wrong' },
      'reading.track': { docId, page: 3, seconds: 12 },
      'plan.save': {
        docId,
        input: {
          examDate: null,
          totalHours: 6,
          hoursPerDay: null,
          targetScore: 0.6,
          mode: 'max_score',
          format: 'mixed',
          overrides: []
        }
      },
      'settings.update': { theme: 'dark' },
      'settings.setApiKey': { apiKey: null },
      'ai.health': { provider: null },
      'ai.claudeLogin': { method: 'claudeai' },
      'ai.claudeLoginCode': { code: 'abc' },
      'ai.listModels': { baseUrl: 'http://localhost:11434/v1' },
      'jobs.list': { docId: null },
      'jobs.cancel': { jobId: 'none' },
      'cards.exportAnki': { docId: null },
      'chat.ask': { docId, page: 12, question: 'Why light?', history: [], mode: 'chat' },
      'chat.cancel': { requestId: 'none' },
      'plan.importPastPaper': { docId, paths: [] },
      'progress.reset': { docId, topicId: null },
      'annotations.save': { docId, page: 3, kind: 'bookmark', text: '' },
      'annotations.delete': { docId, page: 3, kind: 'bookmark' },
      'lessons.generate': { docId, topicId: null },
      'exam.saveProfile': {
        docId,
        formats: { mcq: 1, written: 0, numeric: 0 },
        formulas: 'none',
        formulaSheet: false
      },
      'cards.rebuildForExam': { docId }
    }
    const docChannels = [
      'library.get',
      'index.start',
      'index.pause',
      'index.status',
      'topics.list',
      'topics.rebuild',
      'plan.get',
      'plan.topics',
      'plan.today',
      'library.cheatSheet',
      'library.overview',
      'library.prepare',
      'annotations.list',
      'lessons.list',
      'exam.getProfile'
    ]
    const empty = [
      'app.info',
      'library.list',
      'settings.get',
      'usage.summary',
      'ai.claudeAccount',
      'ai.claudeLoginCancel',
      'ai.claudeLogout'
    ]
    for (const channel of contractChannels) {
      if (channel === 'quiz.answer' || channel === 'quiz.finish') continue
      const input =
        inputs[channel] ??
        (docChannels.includes(channel) ? { docId } : empty.includes(channel) ? {} : undefined)
      expect(input, `test input for ${channel}`).toBeDefined()
      const res = await api.invoke(channel, input as never)
      expect(res.ok, `${channel}: ${res.ok ? '' : res.error.message}`).toBe(true)
    }
    const quiz = await api.invoke('quiz.pageCheck', { docId, page: 40 })
    if (!quiz.ok) throw new Error('no quiz')
    const q = quiz.data.questions[0]!
    expect(
      (
        await api.invoke('quiz.answer', {
          quizId: quiz.data.id,
          questionId: q.id,
          response: { type: 'tf', value: true },
          elapsedMs: 5
        })
      ).ok
    ).toBe(true)
    expect((await api.invoke('quiz.finish', { quizId: quiz.data.id })).ok).toBe(true)
  })

  it('validates input with the contract schemas', async () => {
    const res = await mock().invoke('library.pageNotes', { docId: 'optical-networks', page: 0 })
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.error.kind).toBe('validation')
  })

  it('returns not_found for unknown documents', async () => {
    const res = await mock().invoke('library.get', { docId: 'nope' })
    expect(!res.ok && res.error.kind).toBe('not_found')
  })
})

describe('event subscriptions', () => {
  const wrapper = (qc: QueryClient) =>
    function Wrapper({ children }: { children: ReactNode }) {
      return createElement(QueryClientProvider, { client: qc }, children)
    }

  it('library.changed refetches the library; ai.rateLimited feeds the banner state', async () => {
    const api = mock()
    setBridge(api)
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => {
        useApiEvents()
        return { library: useLibrary(), rate: useRateLimit() }
      },
      { wrapper: wrapper(qc) }
    )
    await waitFor(() => expect(result.current.library.data).toHaveLength(3))
    await api.invoke('library.import', { paths: ['/home/me/New course.pdf'] })
    await waitFor(() => expect(result.current.library.data).toHaveLength(4))

    api.emit('ai.rateLimited', { resetAt: '2030-01-01T14:30:00Z', message: 'limit' })
    await waitFor(() => expect(result.current.rate.data?.message).toBe('limit'))
    api.emit('ai.rateLimited', null)
    await waitFor(() => expect(result.current.rate.data).toBeNull())
  })
})
