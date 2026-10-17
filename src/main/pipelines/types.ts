import type { ProviderId } from '@shared/ai/provider'
import type { IpcChannel, IpcEvent, IpcEvents, IpcOutput, IpcParsedInput } from '@shared/ipc/contract'
import type { StudyAi } from '../ai/types'
import type { Database } from '../db/types'
import type { JobQueue } from '../jobs/types'
import type { PdfLibrary } from '../library/types'
import type { Srs } from '../srs/types'

/**
 * Pipelines contract: the application services behind every IPC channel.
 * - src/main/pipelines implements `createPipelines(deps)` (business logic, jobs, persistence).
 * - src/main/index.ts + src/main/app build the deps (composition root) and src/main/ipc registers
 *   `handlers` on ipcMain, validating inputs with the contract's zod schemas first.
 */

/** One async function per IPC channel; input is already validated. Throw `ServiceError` for expected failures. */
export type Handlers = { [C in IpcChannel]: (input: IpcParsedInput<C>) => Promise<IpcOutput<C>> }

export type EmitEvent = <E extends IpcEvent>(event: E, payload: IpcEvents[E]) => void

/** API key storage; encryption (Electron safeStorage) is the composition root's job. */
export interface SecretStore {
  getApiKey(): string | null
  setApiKey(key: string | null): void
}

export interface PipelineDeps {
  db: Database
  library: PdfLibrary
  queue: JobQueue
  srs: Srs
  /**
   * StudyAi for the given provider, or for the provider in current settings when omitted.
   * The composition root caches instances and rebuilds them when settings or the API key change.
   */
  aiFor(provider?: ProviderId): StudyAi
  secrets: SecretStore
  emit: EmitEvent
  now(): Date
  /** Native "open PDFs" dialog; resolves [] when cancelled. */
  pickPdfs(): Promise<string[]>
  appInfo: { version: string; platform: string; dataDir: string }
}

export interface Pipelines {
  handlers: Handlers
  /** Register job handlers, requeue interrupted work, start the queue. */
  start(): void
  stop(): Promise<void>
}

export type CreatePipelines = (deps: PipelineDeps) => Pipelines

export type ServiceErrorKind = 'validation' | 'not_found' | 'conflict' | 'ai' | 'rate_limited'

/** Expected failure; the IPC layer maps it to an envelope error of the same kind. Anything else is 'internal'. */
export class ServiceError extends Error {
  readonly kind: ServiceErrorKind
  readonly resetAt: string | null
  constructor(kind: ServiceErrorKind, message: string, resetAt: string | null = null) {
    super(message)
    this.name = 'ServiceError'
    this.kind = kind
    this.resetAt = resetAt
  }
}
