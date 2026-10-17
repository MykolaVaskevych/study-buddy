import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AiTask, GenerateRequest, GenerateResult, LlmProvider, PromptPart } from '@shared/ai/provider'
import type { DocId, Question, QuestionResponse } from '@shared/domain'
import type { IpcEvent, IpcEvents } from '@shared/ipc/contract'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { createFakeProvider } from '../ai/providers/fake/provider'
import { createStudyAi } from '../ai/study-ai'
import { openDatabase } from '../db'
import type { Database } from '../db/types'
import { createJobQueue } from '../jobs'
import type { JobQueue } from '../jobs/types'
import { DEFAULT_CHUNK_OPTIONS, createPdfLibrary } from '../library'
import type { PdfLibrary } from '../library/types'
import { createSrs } from '../srs'
import { DEFAULT_PIPELINE_OPTIONS, createPipelinesWith, type PipelineOptions } from './index'
import type { Handlers, Pipelines, SecretStore } from './types'

/**
 * Test-only (imported by *.test.ts): the pipelines over REAL modules. In-memory SQLite, the library
 * on a temp dir (in-process), a real job queue with real timers and tiny backoff, FSRS without fuzz,
 * StudyAi over the offline fake provider (or one passed in), a fixed clock and an event recorder.
 */

export const START = '2026-10-17T10:00:00.000Z'

export interface Harness {
  pipelines: Pipelines
  h: Handlers
  db: Database
  queue: JobQueue
  library: PdfLibrary
  secrets: SecretStore
  fixture: string
  libraryDir: string
  clock: { now: () => Date; set: (iso: string) => void; advance: (ms: number) => void }
  events: { event: IpcEvent; payload: unknown }[]
  eventsOf<E extends IpcEvent>(event: E): IpcEvents[E][]
  /** Resolves when no job is queued or running (fails after `timeoutMs`). */
  waitIdle(timeoutMs?: number): Promise<void>
  /** Imports the fixture and waits for indexing and the topic map. */
  importIndexed(): Promise<DocId>
  close(): Promise<void>
}

export interface HarnessOptions {
  provider?: LlmProvider
  options?: Partial<PipelineOptions>
  /** Call pipelines.start() (default true). */
  start?: boolean
  concurrency?: number
}

export async function createHarness(opts: HarnessOptions = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'sb-pipelines-'))
  const fixture = await writeFixturePdf(join(dir, 'src'))
  let now = new Date(START)
  const clock = {
    now: () => new Date(now),
    set: (iso: string) => {
      now = new Date(iso)
    },
    advance: (ms: number) => {
      now = new Date(now.getTime() + ms)
    }
  }
  const db = openDatabase(':memory:', { now: clock.now })
  const libraryDir = join(dir, 'library')
  const library = createPdfLibrary({ rootDir: libraryDir, chunk: DEFAULT_CHUNK_OPTIONS }, { inWorker: false })
  // Real time for the queue: its backoff compares its own timestamps, a frozen clock would stall retries.
  const queue = createJobQueue({
    repo: db.jobs,
    concurrency: opts.concurrency ?? 2,
    backoffMs: [5],
    progressThrottleMs: 0
  })
  const ai = createStudyAi(opts.provider ?? createFakeProvider())
  let apiKey: string | null = null
  const secrets: SecretStore = {
    getApiKey: () => apiKey,
    setApiKey: (key) => {
      apiKey = key
    }
  }
  const events: Harness['events'] = []
  const pipelines = createPipelinesWith(
    {
      db,
      library,
      queue,
      srs: createSrs({ fuzz: false }),
      aiFor: () => ai,
      secrets,
      emit: (event, payload) => {
        events.push({ event, payload })
      },
      now: clock.now,
      pickPdfs: async () => [fixture],
      appInfo: { version: '0.0.0-test', platform: 'test', dataDir: dir }
    },
    { ...DEFAULT_PIPELINE_OPTIONS, ...opts.options }
  )
  // Settings are the queue's source of truth: start() applies aiConcurrency.
  if (opts.concurrency !== undefined) db.settings.update({ aiConcurrency: opts.concurrency })
  if (opts.start !== false) pipelines.start()

  const waitIdle = async (timeoutMs = 15_000): Promise<void> => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const active = db.jobs.list(null, 10_000).filter((j) => j.state === 'queued' || j.state === 'running')
      if (active.length === 0) return
      if (Date.now() > deadline) {
        throw new Error(`Jobs still active: ${active.map((j) => `${j.label} (${j.state})`).join(', ')}`)
      }
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
  }

  return {
    pipelines,
    h: pipelines.handlers,
    db,
    queue,
    library,
    secrets,
    fixture,
    libraryDir,
    clock,
    events,
    eventsOf: <E extends IpcEvent>(event: E) =>
      events.filter((e) => e.event === event).map((e) => e.payload as IpcEvents[E]),
    waitIdle,
    async importIndexed() {
      const [doc] = await pipelines.handlers['library.import']({ paths: [fixture] })
      if (!doc) throw new Error('fixture import returned nothing')
      await waitIdle()
      return doc.id
    },
    async close() {
      await pipelines.stop()
      db.close()
      await rm(dir, { recursive: true, force: true })
    }
  }
}

export interface RecordedCall {
  task: AiTask
  parts: PromptPart[]
  /** "Focus pages: a-b" from the prompt header, if present. */
  focus: { from: number; to: number } | null
}

/** Wraps a provider and records every generate() request. */
export function recordingProvider(
  inner: LlmProvider = createFakeProvider(),
  overrides: Partial<Pick<LlmProvider, 'id'>> = {}
): LlmProvider & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = []
  return {
    id: overrides.id ?? inner.id,
    capabilities: inner.capabilities,
    calls,
    async generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
      const text = req.parts.map((p) => (p.type === 'text' ? p.text : '')).join('\n')
      const m = /^Focus pages: (\d+)-(\d+)$/m.exec(text)
      calls.push({
        task: req.task,
        parts: req.parts,
        focus: m ? { from: Number(m[1]), to: Number(m[2]) } : null
      })
      return inner.generate(req)
    },
    stream: (req) => inner.stream(req),
    health: (signal) => inner.health(signal)
  }
}

/** The response that answers a question correctly. */
export function correctResponse(q: Question): QuestionResponse {
  const a = q.answer
  switch (a.type) {
    case 'mcq':
      return { type: 'mcq', index: a.correctIndex }
    case 'multi':
      return { type: 'multi', indices: a.correctIndices }
    case 'tf':
      return { type: 'tf', value: a.value }
    case 'short':
      return { type: 'short', text: a.modelAnswer }
    case 'numeric':
      return { type: 'numeric', value: a.value, unit: a.unit }
  }
}

/** A response that is certainly wrong. */
export function wrongResponse(q: Question): QuestionResponse {
  const a = q.answer
  switch (a.type) {
    case 'mcq':
      return { type: 'mcq', index: (a.correctIndex + 1) % Math.max(2, q.options?.length ?? 2) }
    case 'multi':
      return { type: 'multi', indices: [] }
    case 'tf':
      return { type: 'tf', value: !a.value }
    case 'short':
      return { type: 'short', text: 'I do not know' }
    case 'numeric':
      return { type: 'numeric', value: a.value * 1000 + 1, unit: a.unit }
  }
}
