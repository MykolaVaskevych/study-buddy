import { useEffect, useState } from 'react'
import {
  keepPreviousData,
  queryOptions,
  useMutation,
  useQueries,
  useQuery,
  useQueryClient
} from '@tanstack/react-query'
import type { QueryClient, QueryKey } from '@tanstack/react-query'
import type { IpcChannel, IpcInput, IpcOutput } from '@shared/ipc/contract'
import type {
  DocumentSummary,
  IndexStatus,
  JobInfo,
  PortalDownload,
  RateLimitInfo,
  Scope
} from '@shared/domain'
import type { ClaudeAccount, CodexAccount } from '@shared/ai/connections'
import { call, subscribe } from './client'

/**
 * Typed TanStack Query hooks, one per IPC channel. Components never call `call()` directly.
 *
 * Query keys are `[channel, input]`, so invalidating `[channel, { docId }]` matches every query
 * of that channel for the document (TanStack matches object keys partially).
 * Main pushes events; `useApiEvents` turns them into cache updates and invalidations.
 */

declare module '@tanstack/react-query' {
  interface Register {
    /** silent: don't toast failures (background reporting such as reading.track). */
    queryMeta: { silent?: boolean }
    mutationMeta: { silent?: boolean }
  }
}

export function channelKey<C extends IpcChannel>(channel: C, input?: Partial<IpcInput<C>>): QueryKey {
  return input === undefined ? [channel] : [channel, input]
}

function channelQuery<C extends IpcChannel>(channel: C, input: IpcInput<C>) {
  return queryOptions<IpcOutput<C>>({
    queryKey: [channel, input],
    queryFn: () => call(channel, input)
  })
}

interface MutationOptions<C extends IpcChannel> {
  onSuccess?: (data: IpcOutput<C>, input: IpcInput<C>, qc: QueryClient) => void
  silent?: boolean
}

function useChannelMutation<C extends IpcChannel>(channel: C, options: MutationOptions<C> = {}) {
  const qc = useQueryClient()
  return useMutation<IpcOutput<C>, Error, IpcInput<C>>({
    mutationKey: [channel],
    mutationFn: (input) => call(channel, input),
    onSuccess: (data, input) => options.onSuccess?.(data, input, qc),
    meta: options.silent ? { silent: true } : undefined
  })
}

const invalidate = (qc: QueryClient, ...keys: QueryKey[]): void => {
  for (const queryKey of keys) void qc.invalidateQueries({ queryKey })
}

const docKeys = (docId: string): QueryKey[] => [['library.list'], channelKey('library.get', { docId })]

// ------------------------------------------------------------------ app

export const useAppInfo = () => useQuery({ ...channelQuery('app.info', {}), staleTime: Infinity })

// ------------------------------------------------------------------ library

export const useLibrary = () => useQuery(channelQuery('library.list', {}))

export const useDocument = (docId: string) => useQuery(channelQuery('library.get', { docId }))

/** Full-text search; disabled until the query has two characters. Keeps old hits while typing. */
export const useLibrarySearch = (query: string, docId: string | null = null, limit = 30) => {
  const q = query.trim()
  return useQuery({
    ...channelQuery('library.search', { query: q, docId, limit }),
    enabled: q.length >= 2,
    placeholderData: keepPreviousData,
    staleTime: 30_000
  })
}

export const usePageNotes = (docId: string, page: number) =>
  useQuery({ ...channelQuery('library.pageNotes', { docId, page }), staleTime: 60_000 })

/** Warms the notes cache for neighbouring pages so paging through slides feels instant. */
export function usePrefetchPageNotes(docId: string, pages: number[]): void {
  const qc = useQueryClient()
  const key = pages.join(',')
  useEffect(() => {
    for (const page of key.split(',').map(Number)) {
      if (page >= 1)
        void qc.prefetchQuery({ ...channelQuery('library.pageNotes', { docId, page }), staleTime: 60_000 })
    }
  }, [qc, docId, key])
}

export const useImportPdfs = () =>
  useChannelMutation('library.import', {
    onSuccess: (_d, _i, qc) => invalidate(qc, ['library.list'], ['courses.list'])
  })

/** Courses (subjects) with their files, in sidebar order. */
export const useCourses = () => useQuery(channelQuery('courses.list', {}))

const invalidateCourses = (qc: QueryClient): void => invalidate(qc, ['courses.list'], ['library.list'])
export const useCreateCourse = () =>
  useChannelMutation('courses.create', { onSuccess: (_d, _i, qc) => invalidateCourses(qc) })
export const useRenameCourse = () =>
  useChannelMutation('courses.rename', { onSuccess: (_d, _i, qc) => invalidateCourses(qc) })
export const useDissolveCourse = () =>
  useChannelMutation('courses.dissolve', { onSuccess: (_d, _i, qc) => invalidateCourses(qc) })
/** Drag and drop: the returned order is applied at once, so rows don't jump back while refetching. */
export const useMoveDocument = () =>
  useChannelMutation('courses.moveDocument', {
    onSuccess: (data, _i, qc) => qc.setQueryData(channelKey('courses.list', {}), data)
  })
/** Shown inside its dialog, so no global error toast. */
export const useSuggestNames = () => useChannelMutation('courses.suggestNames', { silent: true })
export const useReorderCourses = () =>
  useChannelMutation('courses.reorder', {
    onSuccess: (data, _i, qc) => qc.setQueryData(channelKey('courses.list', {}), data)
  })

export const useRenameDocument = () =>
  useChannelMutation('library.rename', {
    onSuccess: (_d, { docId }, qc) => invalidate(qc, ...docKeys(docId))
  })

export const useDeleteDocument = () =>
  useChannelMutation('library.delete', { onSuccess: (_d, _i, qc) => invalidate(qc, ['library.list']) })

export const useSetLastPage = () =>
  useChannelMutation('library.setLastPage', {
    silent: true,
    onSuccess: (_d, { docId, page }, qc) => {
      // Patch in place: refetching the whole library on every page turn is wasteful.
      qc.setQueryData<DocumentSummary[]>(['library.list', {}], (old) =>
        old?.map((d) => (d.id === docId ? { ...d, lastPage: page } : d))
      )
    }
  })

// ------------------------------------------------------------------ index pass

export const useIndexStatus = (docId: string) => useQuery(channelQuery('index.status', { docId }))

const setIndexStatus = (qc: QueryClient, docId: string, status: IndexStatus): void => {
  qc.setQueryData(['index.status', { docId }], status)
  qc.setQueryData<DocumentSummary[]>(['library.list', {}], (old) =>
    old?.map((d) => (d.id === docId ? { ...d, index: status } : d))
  )
}

export const useStartIndex = () =>
  useChannelMutation('index.start', {
    onSuccess: (status, { docId }, qc) => setIndexStatus(qc, docId, status)
  })

export const usePauseIndex = () =>
  useChannelMutation('index.pause', {
    onSuccess: (status, { docId }, qc) => setIndexStatus(qc, docId, status)
  })

export const useIndexFocus = () => useChannelMutation('index.focus', { silent: true })

// ------------------------------------------------------------------ topics

export const useTopics = (docId: string) => useQuery(channelQuery('topics.list', { docId }))
/** Topics of several files at once (a quiz or cram that spans a course), merged. */
export const useTopicsOf = (docIds: readonly string[]) =>
  useQueries({
    queries: docIds.map((docId) => channelQuery('topics.list', { docId })),
    combine: (results) => results.flatMap((r) => r.data ?? [])
  })

export const useRebuildTopics = () => useChannelMutation('topics.rebuild')

// ------------------------------------------------------------------ flashcards

export const useCards = (scope: Scope, includeInactive = false) =>
  useQuery(channelQuery('cards.list', { scope, includeInactive }))

export const useDueCards = (docId: string | null, limit = 200) =>
  useQuery(channelQuery('cards.due', { docId, limit }))

export const useCardStats = (docId: string | null) => useQuery(channelQuery('cards.stats', { docId }))

const invalidateCards = (qc: QueryClient): void =>
  invalidate(qc, ['cards.list'], ['cards.due'], ['cards.stats'], ['library.list'])

export const useGenerateCards = () => useChannelMutation('cards.generate')
export const useReviewCard = () =>
  useChannelMutation('cards.review', { onSuccess: (_d, _i, qc) => invalidateCards(qc) })
export const useUpdateCard = () =>
  useChannelMutation('cards.update', { onSuccess: (_d, _i, qc) => invalidateCards(qc) })
export const useSetCardStatus = () =>
  useChannelMutation('cards.setStatus', { onSuccess: (_d, _i, qc) => invalidateCards(qc) })

// ------------------------------------------------------------------ quizzes

/** Creating a quiz has side effects (it may generate questions), so it's a mutation. */
export const useCreateQuiz = () => useChannelMutation('quiz.create')
/** A cram's questions across files or chapters (may wait for the AI to write a few). */
export const useCramQuiz = () => useChannelMutation('cram.quiz')
/** "Don't panic": the cards and question mix for a short cram (no AI call). */
export const useCramPlan = () => useChannelMutation('cram.plan')
/** "Test me" on a page; instant when the page check was prefetched. */
export const useStartPageCheck = () => useChannelMutation('quiz.pageCheck')
export const useAnswerQuestion = () => useChannelMutation('quiz.answer')
export const useFinishQuiz = () =>
  useChannelMutation('quiz.finish', {
    onSuccess: (_d, _i, qc) => invalidate(qc, ['quiz.history'], ['topics.list'])
  })
export const useQuizHistory = (docId: string, limit = 20) =>
  useQuery(channelQuery('quiz.history', { docId, limit }))
export const useReportQuestion = () => useChannelMutation('quiz.reportQuestion')

// ------------------------------------------------------------------ reading

export const useTrackReading = () => useChannelMutation('reading.track', { silent: true })

// ------------------------------------------------------------------ planner

export const usePlan = (docId: string) => useQuery(channelQuery('plan.get', { docId }))
export const usePlanTopics = (docId: string) => useQuery(channelQuery('plan.topics', { docId }))
export const useTodayPlan = (docId: string) => useQuery(channelQuery('plan.today', { docId }))
/** Today's sessions for several books at once (the library's Today widget); shares useTodayPlan's cache. */
export const useTodayPlans = (docIds: string[]) =>
  useQueries({ queries: docIds.map((docId) => channelQuery('plan.today', { docId })) })
export const useSavePlan = () =>
  useChannelMutation('plan.save', {
    onSuccess: (plan, { docId }, qc) => {
      qc.setQueryData(['plan.get', { docId }], plan)
      invalidate(qc, channelKey('plan.today', { docId }), ['library.list'])
    }
  })

// ------------------------------------------------------------------ settings & AI

export const useSettings = () => useQuery({ ...channelQuery('settings.get', {}), staleTime: Infinity })

export const useUpdateSettings = () =>
  useChannelMutation('settings.update', {
    onSuccess: (s, _i, qc) => qc.setQueryData(['settings.get', {}], s)
  })

export const useSetApiKey = () =>
  useChannelMutation('settings.setApiKey', {
    onSuccess: (s, _i, qc) => qc.setQueryData(['settings.get', {}], s)
  })

/** Health check is an explicit action ("Test connection"), not something to poll. */
export const useCheckAiHealth = () => useChannelMutation('ai.health')

const accountKey: QueryKey = ['ai.claudeAccount', {}]
const setAccount = (a: ClaudeAccount, _i: unknown, qc: QueryClient): void => {
  qc.setQueryData(accountKey, a)
}

/** Claude Code's login; asking runs the CLI, so it is cached for a while and refreshed on focus. */
export const useClaudeAccount = (enabled = true) =>
  useQuery({ ...channelQuery('ai.claudeAccount', {}), enabled, staleTime: 60_000 })
export const useClaudeLogin = () => useChannelMutation('ai.claudeLogin')
export const useClaudeLoginCode = () => useChannelMutation('ai.claudeLoginCode', { onSuccess: setAccount })
export const useClaudeLoginCancel = () => useChannelMutation('ai.claudeLoginCancel', { silent: true })
export const useClaudeLogout = () => useChannelMutation('ai.claudeLogout', { onSuccess: setAccount })

const setCodexAccount = (a: CodexAccount, _i: unknown, qc: QueryClient): void => {
  qc.setQueryData(['ai.codexAccount', {}], a)
}
/** Codex's sign-in state; asking runs the CLI, so it is cached for a while. */
export const useCodexAccount = (enabled = true) =>
  useQuery({ ...channelQuery('ai.codexAccount', {}), enabled, staleTime: 60_000 })
export const useCodexLogin = () => useChannelMutation('ai.codexLogin')
/** Waits (up to 15 minutes) for the student to enter the device code. */
export const useCodexLoginWait = () => useChannelMutation('ai.codexLoginWait', { onSuccess: setCodexAccount })
export const useCodexLoginCancel = () => useChannelMutation('ai.codexLoginCancel', { silent: true })
export const useCodexLogout = () => useChannelMutation('ai.codexLogout', { onSuccess: setCodexAccount })

/** Models on an OpenAI-compatible server; a failure comes back as `error`, not as a thrown error. */
export const useServerModels = (baseUrl: string | null) =>
  useQuery({
    ...channelQuery('ai.listModels', { baseUrl: baseUrl ?? '' }),
    enabled: baseUrl !== null,
    staleTime: 30_000,
    retry: false
  })

// ------------------------------------------------------------------ jobs & usage

export const useJobs = (docId: string | null = null) => useQuery(channelQuery('jobs.list', { docId }))
export const useCancelJob = () => useChannelMutation('jobs.cancel')
export const useUsage = () => useQuery(channelQuery('usage.summary', {}))

// ------------------------------------------------------------------ events

/** Rate-limit state lives in the query cache under this key (no channel; fed by events/errors). */
export const rateLimitKey: QueryKey = ['event', 'ai.rateLimited']

export function setRateLimit(qc: QueryClient, info: RateLimitInfo | null): void {
  qc.setQueryData(rateLimitKey, info)
}

export const useRateLimit = () =>
  useQuery<RateLimitInfo | null>({
    queryKey: rateLimitKey,
    queryFn: () => null,
    initialData: null,
    staleTime: Infinity,
    gcTime: Infinity
  })

const ACTIVE: JobInfo['state'][] = ['queued', 'running', 'paused']

/** Upserts a job into every cached jobs.list whose filter includes it; finished jobs drop out. */
export function applyJobChange(qc: QueryClient, job: JobInfo): void {
  for (const [key, data] of qc.getQueriesData<JobInfo[]>({ queryKey: ['jobs.list'] })) {
    const filter = key[1]
    const filterDoc = typeof filter === 'object' && filter !== null && 'docId' in filter ? filter.docId : null
    if (filterDoc !== null && filterDoc !== job.docId) continue
    const rest = (data ?? []).filter((j) => j.id !== job.id)
    qc.setQueryData(key, ACTIVE.includes(job.state) ? [...rest, job] : rest)
  }
  qc.setQueryData(jobKey(job.id), job)
  if (job.state !== 'done' || job.docId === null) return
  const docId = job.docId
  switch (job.kind) {
    case 'index_chunk':
      invalidate(qc, channelKey('library.pageNotes', { docId }), channelKey('index.status', { docId }))
      break
    case 'topic_map':
      invalidate(qc, channelKey('topics.list', { docId }), channelKey('plan.topics', { docId }), [
        'library.list'
      ])
      break
    case 'generate_cards':
      invalidateCards(qc)
      break
    case 'generate_questions':
    case 'page_check':
    case 'verify_questions':
      invalidate(qc, ['quiz.history'])
      break
  }
}

interface ApiEventOptions {
  onJobFailed?: (job: JobInfo) => void
}

/** Subscribes to main's push events for the lifetime of the app. Mount once (app/providers). */
export function useApiEvents({ onJobFailed }: ApiEventOptions = {}): void {
  const qc = useQueryClient()
  useEffect(() => {
    const offs = [
      subscribe('jobs.changed', (job) => {
        if (job.kind === 'write_lesson' && job.state === 'done' && job.docId)
          void qc.invalidateQueries({ queryKey: channelKey('lessons.list', { docId: job.docId }) })
        applyJobChange(qc, job)
        if (job.state === 'failed') onJobFailed?.(job)
      }),
      subscribe('index.progress', ({ docId, status }) => {
        setIndexStatus(qc, docId, status)
        invalidate(qc, channelKey('library.pageNotes', { docId }))
      }),
      subscribe('library.changed', ({ docId }) => {
        invalidate(
          qc,
          ['library.list'],
          ['courses.list'],
          docId ? channelKey('library.get', { docId }) : ['library.get']
        )
        if (docId) invalidate(qc, channelKey('topics.list', { docId }))
      }),
      subscribe('cards.changed', () => invalidateCards(qc)),
      subscribe('portal.changed', (state) => qc.setQueryData(channelKey('portal.state', {}), state)),
      subscribe('portal.agent', (state) => qc.setQueryData(channelKey('portal.agentState', {}), state)),
      subscribe('pageCheck.ready', ({ docId, page }) => {
        invalidate(qc, channelKey('quiz.history', { docId }))
        markPageCheckReady(qc, docId, page)
      }),
      subscribe('ai.rateLimited', (info) => setRateLimit(qc, info))
    ]
    return () => {
      for (const off of offs) off()
    }
  }, [qc, onJobFailed])
}

// ------------------------------------------------------------------ study portal (in-app browser)

/** What the portal browser shows; kept current by 'portal.changed' events. */
export const usePortalState = () => useQuery(channelQuery('portal.state', {}))
const setPortalState = (qc: QueryClient, state: IpcOutput<'portal.state'>): void => {
  qc.setQueryData(channelKey('portal.state', {}), state)
}
export const usePortalOpen = () =>
  useChannelMutation('portal.open', { silent: true, onSuccess: (s, _i, qc) => setPortalState(qc, s) })
export const usePortalClose = () => useChannelMutation('portal.close', { silent: true })
export const usePortalBounds = () => useChannelMutation('portal.setBounds', { silent: true })
export const usePortalCourse = () =>
  useChannelMutation('portal.setCourse', { onSuccess: (s, _i, qc) => setPortalState(qc, s) })
export const usePortalNavigate = () =>
  useChannelMutation('portal.navigate', { onSuccess: (s, _i, qc) => setPortalState(qc, s) })
export const usePortalGo = () =>
  useChannelMutation('portal.go', { silent: true, onSuccess: (s, _i, qc) => setPortalState(qc, s) })
export const usePortalSignOut = () => useChannelMutation('portal.signOut')
/** "Get files with AI": its state, kept current by 'portal.agent' events. */
export const usePortalAgent = () => useQuery(channelQuery('portal.agentState', {}))
const setAgentState = (qc: QueryClient, state: IpcOutput<'portal.agentState'>): void => {
  qc.setQueryData(channelKey('portal.agentState', {}), state)
}
export const usePortalAgentStart = () =>
  useChannelMutation('portal.agentStart', { onSuccess: (s, _i, qc) => setAgentState(qc, s) })
export const usePortalAgentStop = () =>
  useChannelMutation('portal.agentStop', { onSuccess: (s, _i, qc) => setAgentState(qc, s) })

/** Files downloaded in the portal this session, newest first. */
export function usePortalDownloads(): PortalDownload[] {
  const [downloads, setDownloads] = useState<PortalDownload[]>([])
  useEffect(() => subscribe('portal.downloaded', (d) => setDownloads((all) => [d, ...all].slice(0, 20))), [])
  return downloads
}

// ------------------------------------------------------------------ study (page checks, card jobs)

/** Latest state of one background job, fed by `jobs.changed` (see applyJobChange). */
export const jobKey = (jobId: string): QueryKey => ['event', 'job', jobId]

/**
 * Follows one job (e.g. the one `cards.generate` returned). Unlike `jobs.list` it keeps the job
 * after it finishes, so callers can tell "done" from "failed". null until the first event.
 */
export function useJob(jobId: string | null) {
  const qc = useQueryClient()
  return useQuery<JobInfo | null>({
    queryKey: jobKey(jobId ?? ''),
    // Events may have arrived before the caller knew the id: fall back to a cached jobs.list.
    queryFn: () =>
      qc
        .getQueriesData<JobInfo[]>({ queryKey: ['jobs.list'] })
        .flatMap(([, jobs]) => jobs ?? [])
        .find((j) => j.id === jobId) ?? null,
    enabled: jobId !== null,
    staleTime: Infinity
  })
}

/** Pages whose page check main has prefetched, per document (fed by `pageCheck.ready`). */
export const pageCheckReadyKey = (docId: string): QueryKey => ['event', 'pageCheck.ready', docId]

export function markPageCheckReady(qc: QueryClient, docId: string, page: number): void {
  qc.setQueryData<number[]>(pageCheckReadyKey(docId), (old = []) =>
    old.includes(page) ? old : [...old, page]
  )
}

/** True once main reported that the page check for this page is prefetched (starting it is instant). */
export function usePageCheckReady(docId: string, page: number): boolean {
  const ready = useQuery<number[]>({
    queryKey: pageCheckReadyKey(docId),
    queryFn: () => [],
    initialData: [],
    staleTime: Infinity,
    gcTime: Infinity
  })
  return ready.data.includes(page)
}

// ------------------------------------------------------------------ cheat sheet, export, past papers

export const useCheatSheet = (docId: string) => useQuery(channelQuery('library.cheatSheet', { docId }))

export const useExportAnki = () => useChannelMutation('cards.exportAnki')

export const useImportPastPaper = () =>
  useChannelMutation('plan.importPastPaper', {
    onSuccess: (_data, { docId }, qc) =>
      invalidate(
        qc,
        channelKey('exam.getProfile', { docId }),
        channelKey('plan.topics', { docId }),
        channelKey('topics.list', { docId }),
        channelKey('plan.get', { docId }),
        ...docKeys(docId)
      )
  })

/** Saves text as a file through the browser download flow (Electron shows a save dialog). */
export function downloadText(fileName: string, content: string): void {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ------------------------------------------------------------------ overview, progress, annotations

/** Polls quickly while the AI is working on the book, slowly otherwise. */
export const useOverview = (docId: string) =>
  useQuery({
    ...channelQuery('library.overview', { docId }),
    refetchInterval: (q) =>
      q.state.data && (q.state.data.preparing || q.state.data.jobs.length > 0) ? 2000 : 15_000
  })

export const usePrepare = () =>
  useChannelMutation('library.prepare', {
    onSuccess: (_data, { docId }, qc) =>
      invalidate(qc, channelKey('library.overview', { docId }), ...docKeys(docId))
  })

export const useResetProgress = () =>
  useChannelMutation('progress.reset', {
    onSuccess: (_data, { docId }, qc) => {
      invalidate(
        qc,
        channelKey('library.overview', { docId }),
        channelKey('plan.get', { docId }),
        channelKey('plan.topics', { docId }),
        channelKey('topics.list', { docId }),
        ...docKeys(docId)
      )
      invalidateCards(qc)
    }
  })

export const useAnnotations = (docId: string) => useQuery(channelQuery('annotations.list', { docId }))

export const useSaveAnnotation = () =>
  useChannelMutation('annotations.save', {
    silent: true,
    onSuccess: (_data, { docId }, qc) => invalidate(qc, channelKey('annotations.list', { docId }))
  })

export const useDeleteAnnotation = () =>
  useChannelMutation('annotations.delete', {
    onSuccess: (_data, { docId }, qc) => invalidate(qc, channelKey('annotations.list', { docId }))
  })

// ------------------------------------------------------------------ study book

export const useLessons = (docId: string) => useQuery(channelQuery('lessons.list', { docId }))

export const useGenerateLessons = () =>
  useChannelMutation('lessons.generate', {
    onSuccess: (_data, { docId }, qc) => invalidate(qc, channelKey('library.overview', { docId }))
  })

// ------------------------------------------------------------------ exam profile

export const useExamProfile = (docId: string) => useQuery(channelQuery('exam.getProfile', { docId }))

export const useSaveExamProfile = () =>
  useChannelMutation('exam.saveProfile', {
    onSuccess: (_data, { docId }, qc) =>
      invalidate(qc, channelKey('exam.getProfile', { docId }), channelKey('library.overview', { docId }))
  })

export const useRebuildCards = () =>
  useChannelMutation('cards.rebuildForExam', {
    onSuccess: (_data, { docId }, qc) => {
      invalidate(qc, channelKey('library.overview', { docId }))
      invalidateCards(qc)
    }
  })
