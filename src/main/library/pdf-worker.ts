import { parentPort, workerData } from 'node:worker_threads'
import { serializeLibraryError } from './errors'
import { pdfJobSchema, runPdfJob, type WorkerReply } from './job'

/**
 * Worker thread entry (bundled as out/main/pdf-worker.js, see electron.vite.config.ts). Runs the one
 * PdfJob passed as workerData and posts a single WorkerReply. Deliberately thin: all logic lives in
 * job.ts, which is also tested in-process.
 *
 * Keep runtime imports in this module graph relative: under Vitest the worker runs the TS sources
 * through tsx, which does not know the @shared/@main aliases (type-only imports are fine).
 */

async function run(data: unknown): Promise<WorkerReply> {
  const job = pdfJobSchema.safeParse(data)
  if (!job.success)
    return { ok: false, error: { kind: 'io', message: `Invalid PDF job: ${job.error.message}` } }
  try {
    return { ok: true, result: await runPdfJob(job.data) }
  } catch (err) {
    return { ok: false, error: serializeLibraryError(err) }
  }
}

if (!parentPort) throw new Error('pdf-worker must be started as a worker thread')
parentPort.postMessage(await run(workerData))
