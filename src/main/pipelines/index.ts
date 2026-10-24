import { createCards } from './cards'
import { toServiceError } from './errors'
import { createIndexing } from './indexing'
import { createJobWaiter } from './job-waiter'
import { createJobsUsage } from './jobs-usage'
import { createLibraryService } from './library-service'
import { createMaterial } from './material'
import { createPageChecks } from './page-checks'
import { createPlanner } from './planner'
import { PRIORITY } from './priorities'
import { createQuestionGen } from './questions'
import { createQuizzes } from './quizzes'
import { createChat } from './chat'
import { createExtras } from './extras'
import { createPastPapers } from './past-paper'
import { createLessons } from './lessons'
import { createCourses } from './courses'
import { createPortal } from './portal'
import { createCram } from './cram'
import { createExamProfiles } from './exam-profile'
import { createOverview } from './overview'
import { createReading } from './reading'
import { createSettingsService } from './settings-service'
import { createTopics } from './topics'
import type { CreatePipelines, Handlers, PipelineDeps, Pipelines } from './types'
import { createUsageLedger } from './usage'

export type * from './types'
export { ServiceError } from './types'

/** Tunables that are not part of the contract; tests shrink them, the defaults suit the app. */
export interface PipelineOptions {
  /** Most pages one generation request focuses on; larger scopes are split. */
  windowPages: number
  /** Ranges up to this many pages are sent as a focus chunk (pages ± 1) instead of whole chunks. */
  focusMaxPages: number
  /** Raw PDF bytes per request, mirroring the AI module's 22 MB limit so splits happen first. */
  maxRequestBytes: number
}

export const DEFAULT_PIPELINE_OPTIONS: PipelineOptions = {
  windowPages: 40,
  focusMaxPages: 12,
  maxRequestBytes: 22 * 1024 * 1024
}

/** Wraps every handler so expected module errors reach the IPC layer as ServiceErrors. */
function guardAll(handlers: Handlers): Handlers {
  const guarded = Object.fromEntries(
    Object.entries(handlers).map(([channel, handler]: [string, (input: never) => Promise<unknown>]) => [
      channel,
      async (input: never) => {
        try {
          return await handler(input)
        } catch (err) {
          throw toServiceError(err)
        }
      }
    ])
  )
  // Same keys, same signatures: only the error path changed.
  return guarded as Handlers
}

/** createPipelines with explicit tunables (tests); the app uses `createPipelines`. */
export function createPipelinesWith(deps: PipelineDeps, options: PipelineOptions): Pipelines {
  const { queue } = deps
  const waiter = createJobWaiter(queue)
  const ledger = createUsageLedger(deps)
  const material = createMaterial(deps, options)
  const planner = createPlanner(deps)
  // The overview is created after the services it drives; the topic-map callback reaches it here.
  const topicsReady: { notify?: (docId: string) => void } = {}
  const topics = createTopics(deps, {
    ledger,
    material,
    onTopicsReplaced: (docId) => {
      planner.replanIfSaved(docId)
      topicsReady.notify?.(docId)
    }
  })
  const indexing = createIndexing(deps, {
    ledger,
    material,
    waiter,
    onIndexed: (docId) => topics.enqueue(docId, PRIORITY.topicMap)
  })
  const questionGen = createQuestionGen(deps, { ledger, material })
  const pageChecks = createPageChecks(deps, { indexing, questionGen, waiter })
  const cards = createCards(deps, { ledger, material })
  const quizzes = createQuizzes(deps, { ledger, questionGen, pageChecks, planner, waiter })
  const chat = createChat(deps, { ledger, material })
  const lessons = createLessons(deps, { ledger, material })
  const examProfiles = createExamProfiles(deps, { generateCards: cards.handlers['cards.generate'] })
  const pastPapers = createPastPapers(deps, { ledger, material, planner })
  const overview = createOverview(deps, {
    indexing,
    topics,
    planner,
    generateCards: cards.handlers['cards.generate']
  })
  topicsReady.notify = overview.onTopicsReady
  const libraryService = createLibraryService(deps, { indexing })

  const portal = createPortal(deps, { importFiles: libraryService.handlers['library.import'], ledger })
  const handlers = guardAll({
    ...libraryService.handlers,
    ...portal.handlers,
    ...indexing.handlers,
    ...topics.handlers,
    ...cards.handlers,
    ...quizzes.handlers,
    ...createReading(deps, { pageChecks }).handlers,
    ...planner.handlers,
    ...createSettingsService(deps).handlers,
    ...createJobsUsage(deps).handlers,
    ...chat.handlers,
    ...lessons.handlers,
    ...examProfiles.handlers,
    ...createCram(deps).handlers,
    ...createCourses(deps, { ledger, material }).handlers,
    ...pastPapers.handlers,
    ...createExtras(deps).handlers,
    ...overview.handlers
  })

  const unsubscribe: (() => void)[] = []
  let started = false

  return {
    handlers,

    start() {
      if (started) return
      started = true
      portal.start()
      queue.register('index_chunk', indexing.runJob)
      queue.register('topic_map', topics.runJob)
      queue.register('generate_cards', cards.runJob)
      queue.register('generate_questions', questionGen.runGenerate)
      queue.register('page_check', questionGen.runPageCheck)
      queue.register('write_lesson', lessons.runJob)
      unsubscribe.push(
        queue.onChange((job) => {
          deps.emit('jobs.changed', job)
          indexing.onJobChange(job)
        }),
        queue.onPause((until, reason) => {
          deps.emit(
            'ai.rateLimited',
            until === null
              ? null
              : {
                  resetAt: until.toISOString(),
                  message: reason ?? 'The AI provider is rate limiting requests'
                }
          )
        })
      )
      queue.setConcurrency(deps.db.settings.get().aiConcurrency)
      // Re-queues jobs a crash left 'running', then starts pumping.
      queue.start()
      indexing.reconcile()
    },

    async stop() {
      if (!started) return
      started = false
      for (const off of unsubscribe.splice(0)) off()
      await portal.stop()
      await queue.stop()
    }
  }
}

export const createPipelines: CreatePipelines = (deps) => createPipelinesWith(deps, DEFAULT_PIPELINE_OPTIONS)
