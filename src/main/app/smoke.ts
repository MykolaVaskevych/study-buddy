import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Question, QuestionResponse } from '@shared/domain'
import type { IpcParsedInput } from '@shared/ipc/contract'
import type { Handlers } from '../pipelines/types'
import type { Log } from './log'

/**
 * `--smoke` checks. `runSmoke` drives the real user flow through the pipeline handlers (the same
 * functions IPC calls), so with the fake provider it proves import -> index -> topics -> cards ->
 * page check -> plan works end to end in the built app. App code cannot import tests/, so the
 * input PDF is generated here (`writeSmokePdf`).
 */

export interface SmokeStep {
  name: string
  ms: number
  detail: string
}

export interface SmokeReport {
  docId: string
  steps: SmokeStep[]
  totalMs: number
}

/** Thrown by runSmoke; `step` names the failing step, `steps` are the ones that passed before it. */
export class SmokeError extends Error {
  readonly step: string
  readonly steps: SmokeStep[]
  constructor(step: string, message: string, steps: SmokeStep[], cause?: unknown) {
    super(`smoke step "${step}" failed: ${message}`, { cause })
    this.name = 'SmokeError'
    this.step = step
    this.steps = steps
  }
}

export interface SmokeOptions {
  pdfPath: string
  log: Log
  /** Budget for the whole run; a step still running when it is spent fails. */
  timeoutMs: number
  /** Delay between status polls (default 250 ms). */
  pollMs?: number
  /** Clock for the plan's exam date. */
  now?: () => Date
}

const DAY_MS = 86_400_000
const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

function check(condition: boolean, failure: string): asserts condition {
  if (!condition) throw new Error(failure)
}

/** Answers with the question's own key, so grading and mastery updates take the "correct" path. */
export function responseFor(question: Pick<Question, 'answer'>): QuestionResponse {
  const a = question.answer
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

/** A typical plan: exam in two weeks, two hours a day. */
export function smokePlanInput(now: Date): IpcParsedInput<'plan.save'>['input'] {
  return {
    examDate: new Date(now.getTime() + 14 * DAY_MS).toISOString().slice(0, 10),
    totalHours: null,
    hoursPerDay: 2,
    targetScore: 0.7,
    mode: 'max_score',
    format: 'mixed',
    overrides: []
  }
}

/** Races `work` against the run's deadline. The loser keeps running but its result is ignored. */
function beforeDeadline<T>(work: Promise<T>, deadline: number): Promise<T> {
  const remaining = deadline - performance.now()
  if (remaining <= 0) return Promise.reject(new Error('smoke time budget exhausted'))
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error('timed out (smoke budget exhausted)')), remaining)
  })
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer))
}

/**
 * Runs the user flow and returns per-step timings. Throws SmokeError naming the failing step.
 * Steps: import, index, topics, cards (generate, due, review), page check (answer, finish),
 * plan (topics, save, today), usage.
 */
export async function runSmoke(handlers: Handlers, opts: SmokeOptions): Promise<SmokeReport> {
  const { log } = opts
  const pollMs = opts.pollMs ?? 250
  const now = opts.now ?? (() => new Date())
  const started = performance.now()
  const deadline = started + opts.timeoutMs
  const steps: SmokeStep[] = []

  async function step<T>(name: string, run: () => Promise<T>, describe: (value: T) => string): Promise<T> {
    const t0 = performance.now()
    let value: T
    let detail: string
    try {
      value = await beforeDeadline(run(), deadline)
      detail = describe(value)
    } catch (err) {
      throw new SmokeError(name, message(err), [...steps], err)
    }
    const done: SmokeStep = { name, ms: Math.round(performance.now() - t0), detail }
    steps.push(done)
    log.info(`[smoke] ok   ${name} (${done.ms} ms) ${detail}`)
    return value
  }

  /** Reads until `done` holds. `done` may throw to fail fast (e.g. a failed job). */
  async function poll<T>(what: string, read: () => Promise<T>, done: (value: T) => boolean): Promise<T> {
    for (;;) {
      const value = await read()
      if (done(value)) return value
      if (performance.now() + pollMs >= deadline) throw new Error(`timed out waiting for ${what}`)
      await new Promise((resolve) => setTimeout(resolve, pollMs))
    }
  }

  log.info(`[smoke] start: ${opts.pdfPath}`)

  const doc = await step(
    'library.import',
    async () => {
      const docs = await handlers['library.import']({ paths: [opts.pdfPath] })
      const first = docs[0]
      check(first !== undefined, 'no document returned')
      return first
    },
    (d) => `"${d.title}", ${d.pageCount} pages`
  )
  const docId = doc.id

  await step(
    'index.start',
    () => handlers['index.start']({ docId }),
    (s) => `state ${s.state}`
  )

  await step(
    'index.status',
    () =>
      poll(
        'the index pass',
        () => handlers['index.status']({ docId }),
        (s) => {
          check(s.state !== 'error', `index failed: ${s.error ?? 'no reason given'}`)
          return s.state === 'done'
        }
      ),
    (s) => `${s.indexedPages}/${s.totalPages} pages indexed`
  )

  await step(
    'topics.list',
    () =>
      poll(
        'the topic map',
        async () => ({
          topics: await handlers['topics.list']({ docId }),
          jobs: await handlers['jobs.list']({ docId })
        }),
        ({ topics, jobs }) => {
          if (topics.length > 0) return true
          const failed = jobs.find((j) => j.kind === 'topic_map' && j.state === 'failed')
          check(failed === undefined, `topic map job failed: ${failed?.error ?? 'no reason given'}`)
          return false
        }
      ),
    ({ topics }) => `${topics.length} topics`
  )

  const { jobId } = await step(
    'cards.generate',
    () =>
      handlers['cards.generate']({ scope: { kind: 'document', docId }, essentialsOnly: true, count: null }),
    (r) => `job ${r.jobId}`
  )

  await step(
    'jobs.list',
    () =>
      poll(
        'the card generation job',
        () => handlers['jobs.list']({ docId }),
        (jobs) => {
          const job = jobs.find((j) => j.id === jobId)
          if (!job) return false
          check(
            job.state !== 'failed' && job.state !== 'cancelled',
            `card job ${job.state}: ${job.error ?? ''}`
          )
          return job.state === 'done'
        }
      ),
    () => 'card job done'
  )

  const due = await step(
    'cards.due',
    async () => {
      const cards = await handlers['cards.due']({ docId, limit: 50 })
      check(cards.length > 0, 'no cards due after generation')
      return cards
    },
    (cards) => `${cards.length} cards due`
  )

  await step(
    'cards.review',
    () => {
      const [card] = due
      check(card !== undefined, 'no card to review')
      return handlers['cards.review']({ cardId: card.id, rating: 3, elapsedMs: 4_000 })
    },
    (card) => `next due ${card.srs.due}`
  )

  const page = await step(
    'library.pageNotes',
    async () => {
      for (let p = 1; p <= doc.pageCount; p++) {
        const notes = await handlers['library.pageNotes']({ docId, page: p })
        if (notes.indexed && notes.teachable) return p
      }
      throw new Error('no indexed teachable page')
    },
    (p) => `teachable page ${p}`
  )

  const quiz = await step(
    'quiz.pageCheck',
    async () => {
      const session = await handlers['quiz.pageCheck']({ docId, page })
      check(session.questions.length > 0, `page check for page ${page} has no questions`)
      return session
    },
    (s) => `${s.questions.length} questions`
  )

  await step(
    'quiz.answer',
    async () => {
      let correct = 0
      for (const q of quiz.questions) {
        const result = await handlers['quiz.answer']({
          quizId: quiz.id,
          questionId: q.id,
          response: responseFor(q),
          elapsedMs: 10_000
        })
        if (result.correct) correct++
      }
      return correct
    },
    (correct) => `${correct}/${quiz.questions.length} correct`
  )

  await step(
    'quiz.finish',
    () => handlers['quiz.finish']({ quizId: quiz.id }),
    (r) => `score ${r.score}/${r.maxScore}`
  )

  await step(
    'plan.topics',
    async () => {
      const topics = await handlers['plan.topics']({ docId })
      check(topics.length > 0, 'no plan topics')
      return topics
    },
    (t) => `${t.length} plan topics`
  )

  await step(
    'plan.save',
    () => handlers['plan.save']({ docId, input: smokePlanInput(now()) }),
    (plan) =>
      `expected score ${Math.round(plan.result.expectedScore * 100)} %, ${plan.schedule.days.length} days`
  )

  // null is legal (e.g. run just before midnight with a UTC/local day mismatch), so it is reported, not failed.
  await step(
    'plan.today',
    () => handlers['plan.today']({ docId }),
    (day) => (day ? `${day.sessions.length} sessions, ${day.totalMinutes} min` : 'nothing scheduled today')
  )

  await step(
    'usage.summary',
    () => handlers['usage.summary']({}),
    (u) => `month $${u.monthUsd.toFixed(2)}${u.notional ? ' (notional)' : ''}`
  )

  const totalMs = Math.round(performance.now() - started)
  log.info(`[smoke] all ${steps.length} steps passed in ${totalMs} ms`)
  return { docId, steps, totalMs }
}

// ------------------------------------------------------------------ renderer load check

/** The part of WebContents the load check needs. */
export interface LoadingContents {
  once(event: 'did-finish-load', listener: () => void): unknown
  once(
    event: 'did-fail-load',
    listener: (event: unknown, errorCode: number, errorDescription: string) => void
  ): unknown
}

/** Resolves when the renderer finished loading; rejects on a load failure or after `timeoutMs`. */
export function waitForRendererLoad(contents: LoadingContents, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timeout waiting for renderer')), timeoutMs)
    contents.once('did-finish-load', () => {
      clearTimeout(timer)
      resolve()
    })
    contents.once('did-fail-load', (_event, code, description) => {
      clearTimeout(timer)
      reject(new Error(`renderer failed to load: ${code} ${description}`))
    })
  })
}

// ------------------------------------------------------------------ smoke PDF

export const SMOKE_PDF_TITLE = 'Smoke Course: Signals and Noise'

/** Page roles of the generated PDF (1-based absolute pages). */
export const SMOKE_PDF_PAGES = { title: 1, text: 2, formula: 3, exercise: 4 } as const

const SMOKE_PDF_BODY: readonly (readonly string[])[] = [
  [SMOKE_PDF_TITLE, 'Generated by Study Buddy for the --smoke run'],
  [
    'Sampling theorem',
    'A band-limited signal can be rebuilt exactly from its samples when the sampling rate',
    'is more than twice its highest frequency. Twice that frequency is the Nyquist rate.',
    'Sampling below the Nyquist rate causes aliasing: high frequencies fold onto low ones.'
  ],
  [
    'Signal-to-noise ratio',
    'SNR_dB = 10 * log10(P_signal / P_noise)',
    'P_signal: signal power in watts. P_noise: noise power in watts.',
    'Every factor of ten in the power ratio adds 10 dB.'
  ],
  [
    'Try it',
    'A signal has 1 mW of power and the noise 0.01 mW. What is the SNR in dB?',
    'Answer: 10 * log10(1 / 0.01) = 10 * log10(100) = 20 dB.'
  ]
]

/** Writes a 4-page PDF (title, text, formula, exercise) into `dir` and returns its path. */
export async function writeSmokePdf(dir: string): Promise<string> {
  // Loaded lazily: normal app starts never need pdf-lib in the main process.
  const { PDFDocument, StandardFonts } = await import('pdf-lib')
  const doc = await PDFDocument.create()
  doc.setTitle(SMOKE_PDF_TITLE)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const lines of SMOKE_PDF_BODY) {
    const page = doc.addPage([720, 540])
    lines.forEach((line, i) => {
      page.drawText(line, { x: 48, y: 470 - i * 28, size: i === 0 ? 22 : 13, font: i === 0 ? bold : font })
    })
  }
  await mkdir(dir, { recursive: true })
  const path = join(dir, 'smoke.pdf')
  await writeFile(path, await doc.save())
  return path
}

/**
 * The portal browser end to end: a local page links a PDF served as an attachment; opening it in
 * the portal must download it and import it into the chosen course. Needs the real Electron view.
 */
export async function runPortalSmoke(
  handlers: Handlers,
  opts: { pdfPath: string; log: Log; timeoutMs: number }
): Promise<void> {
  const { createServer } = await import('node:http')
  const { readFile } = await import('node:fs/promises')
  // A different file from the main smoke PDF (one byte more), so it imports as a new document.
  const pdf = Buffer.concat([await readFile(opts.pdfPath), Buffer.from('\n%portal\n')])
  const server = createServer((req, res) => {
    if (req.url === '/week5.pdf') {
      res.writeHead(200, {
        'Content-Type': 'application/pdf',
        'Content-Disposition': 'attachment; filename="Week 5.pdf"'
      })
      res.end(pdf)
    } else {
      res.writeHead(200, { 'Content-Type': 'text/html' })
      res.end('<!doctype html><title>Course page</title><a href="/week5.pdf">Week 5 slides</a>')
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const [course] = await handlers['courses.list']({})
    if (!course) throw new Error('portal: no course to download into')
    const before = (await handlers['library.list']({})).length
    await handlers['portal.open']({ bounds: { x: 0, y: 48, width: 800, height: 500 }, courseId: course.id })
    await handlers['portal.navigate']({ url: `http://127.0.0.1:${port}/` })
    const deadline = Date.now() + opts.timeoutMs
    const wait = async (what: string, done: () => Promise<boolean>): Promise<void> => {
      while (!(await done())) {
        if (Date.now() > deadline) throw new Error(`portal: timed out waiting for ${what}`)
        await new Promise((resolve) => setTimeout(resolve, 200))
      }
    }
    await wait('the course page', async () => (await handlers['portal.state']({})).title === 'Course page')
    opts.log.info('[smoke] ok   portal: page loaded in the portal view')
    await handlers['portal.navigate']({ url: `http://127.0.0.1:${port}/week5.pdf` })
    await wait('the downloaded file in the course', async () => {
      const docs = await handlers['library.list']({})
      const files = (await handlers['courses.list']({})).find((c) => c.id === course.id)?.docIds ?? []
      return docs.length > before && files.length > course.docIds.length
    })
    opts.log.info('[smoke] ok   portal: download imported into the course')
    await handlers['portal.close']({})
  } finally {
    server.close()
  }
}

/** Markdown notes end to end: printed by the renderer's print page, imported with a text layer. */
export async function runMarkdownSmoke(handlers: Handlers, opts: { dir: string; log: Log }): Promise<void> {
  await mkdir(opts.dir, { recursive: true })
  const path = join(opts.dir, 'W1_L1.1_Bits_to_Qubits.md')
  await writeFile(
    path,
    [
      '# From Classical Bits to Qubits',
      '',
      'A qubit generalizes the bit: $|\\psi\\rangle = \\alpha|0\\rangle + \\beta|1\\rangle$.',
      '',
      '| Basis | Vector |',
      '| --- | --- |',
      '| zero | $|0\\rangle$ |',
      '',
      '$$P(0) = |\\alpha|^2$$'
    ].join('\n')
  )
  const [doc] = await handlers['library.import']({ paths: [path] })
  if (!doc) throw new Error('markdown: nothing imported')
  if (doc.title !== 'From Classical Bits to Qubits') throw new Error(`markdown: title is "${doc.title}"`)
  if (doc.pageCount < 1) throw new Error('markdown: no pages')
  const hits = await handlers['library.search']({ query: 'qubit', docId: doc.id, limit: 5 })
  if (hits.length === 0) throw new Error('markdown: the printed PDF has no searchable text')
  opts.log.info(`[smoke] ok   markdown: "${doc.title}", ${doc.pageCount} page(s), text searchable`)
}
