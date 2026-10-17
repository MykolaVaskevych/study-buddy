import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { errorMessage } from './errors'
import { runPdfJob, unwrapWorkerReply, type PdfJob, type PdfJobResult } from './job'
import { LibraryError } from './types'

/**
 * Runs PDF jobs off the main thread. pdf.js and pdf-lib are CPU-bound for hundreds of milliseconds to
 * seconds on real books; in the Electron main process that would freeze IPC and the window.
 * One short-lived worker per job: imports are rare, and a fresh thread cannot leak pdf.js state.
 */

export interface ProcessOptions {
  /** Run in a worker thread (the app) or in the calling thread (tools, focused tests). */
  inWorker: boolean
  /** Kills a worker stuck on a pathological file. */
  timeoutMs: number
}

export const DEFAULT_WORKER_TIMEOUT_MS = 5 * 60_000

/** Runs a job in a worker or in-process. This is the seam the library uses for all heavy work. */
export function processPdf(job: PdfJob, options: ProcessOptions): Promise<PdfJobResult> {
  return options.inWorker ? runPdfJobInWorker(job, options.timeoutMs) : runPdfJob(job)
}

/** How to start the worker: the bundled JS entry, or the TS source through the tsx loader. */
export type WorkerEntry = { kind: 'bundled'; path: string } | { kind: 'source'; path: string }

/**
 * Finds the worker entry relative to the module that spawns it.
 * - Built app (also `electron-vite dev`): this module is bundled into out/main/index.js and the worker is
 *   its own entry, out/main/pdf-worker.js. One directory up covers this module landing in a shared chunk
 *   folder (out/main/chunks/) if the bundler ever moves it.
 * - Vitest: modules run from TS sources, so the sibling is src/main/library/pdf-worker.ts.
 */
export function locateWorkerEntry(
  moduleDir: string,
  exists: (path: string) => boolean = existsSync
): WorkerEntry | null {
  for (const dir of [moduleDir, dirname(moduleDir)]) {
    const bundled = join(dir, 'pdf-worker.js')
    if (exists(bundled)) return { kind: 'bundled', path: bundled }
  }
  const source = join(moduleDir, 'pdf-worker.ts')
  return exists(source) ? { kind: 'source', path: source } : null
}

/**
 * Node cannot run the TS worker directly (extensionless imports, no aliases), so source runs preload tsx
 * in the worker. tsx is a devDependency and is only reached when no bundled entry exists, i.e. in tests.
 */
function spawnWorker(entry: WorkerEntry, job: PdfJob): Worker {
  if (entry.kind === 'bundled') return new Worker(entry.path, { workerData: job })
  const tsx = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href
  return new Worker(entry.path, { workerData: job, execArgv: ['--import', tsx] })
}

export function runPdfJobInWorker(job: PdfJob, timeoutMs: number): Promise<PdfJobResult> {
  const entry = locateWorkerEntry(dirname(fileURLToPath(import.meta.url)))
  if (!entry)
    return Promise.reject(new LibraryError('io', 'PDF worker entry not found next to the main bundle'))

  return new Promise<PdfJobResult>((resolve, reject) => {
    let worker: Worker
    try {
      worker = spawnWorker(entry, job)
    } catch (err) {
      reject(new LibraryError('io', `Could not start the PDF worker: ${errorMessage(err)}`, err))
      return
    }
    let settled = false
    const settle = (outcome: () => PdfJobResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      void worker.terminate()
      try {
        resolve(outcome())
      } catch (err) {
        reject(err)
      }
    }
    const timer = setTimeout(() => {
      settle(() => {
        throw new LibraryError(
          'corrupt',
          `PDF processing did not finish within ${Math.round(timeoutMs / 1000)} s`
        )
      })
    }, timeoutMs)

    worker.once('message', (reply: unknown) => settle(() => unwrapWorkerReply(reply)))
    worker.once('error', (err) =>
      settle(() => {
        throw workerCrash(err)
      })
    )
    worker.once('exit', (code) =>
      settle(() => {
        throw new LibraryError('io', `PDF worker exited (code ${code}) without a result`)
      })
    )
  })
}

/** The worker catches job errors itself, so an 'error' event means the thread itself failed. */
function workerCrash(err: Error): LibraryError {
  const code = (err as NodeJS.ErrnoException).code
  if (code === 'ERR_WORKER_OUT_OF_MEMORY') {
    return new LibraryError('too_large', 'The PDF needs more memory than the PDF worker may use', err)
  }
  return new LibraryError('io', `PDF worker crashed: ${err.message}`, err)
}
