/**
 * Local quality eval on a real PDF through the real pipelines and the configured AI provider
 * (default: the Claude subscription). Never runs in CI; it spends real usage.
 *
 *   npm run eval -- <file.pdf> [--provider claude-code|anthropic-api] [--page N] [--hours H]
 *
 * Imports into a throwaway data dir, indexes the whole book, builds the course map, saves a triage
 * plan, generates essentials cards for the first teachable topic and a page check, then prints
 * quality gates: schema/page-range validity, evidence verification rate, answer-key survival, trivia.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import type { ProviderId } from '@shared/ai/provider'
import type { Card, Question } from '@shared/domain'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { createClaudeAuth, createCodexAuth, createProvider, createStudyAi } from '../src/main/ai'
import { openDatabase } from '../src/main/db'
import { createJobQueue } from '../src/main/jobs'
import { createPdfLibrary, DEFAULT_CHUNK_OPTIONS } from '../src/main/library'
import { createPipelines } from '../src/main/pipelines'
import { createDetachedPortal } from '../src/main/portal/detached'
import { createSrs } from '../src/main/srs'

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    provider: { type: 'string', default: 'claude-code' },
    page: { type: 'string', default: '14' },
    hours: { type: 'string', default: '8' }
  }
})
const pdf = positionals[0]
if (!pdf) {
  console.error(
    'usage: npm run eval -- <file.pdf> [--provider claude-code|anthropic-api|openai-compatible] [--page N] [--hours H]\n' +
      '  openai-compatible reads OPENAI_BASE_URL (default Ollama) and OPENAI_API_KEY'
  )
  process.exit(2)
}
const provider = values.provider as ProviderId
const apiKey =
  (provider === 'openai-compatible' ? process.env['OPENAI_API_KEY'] : process.env['ANTHROPIC_API_KEY']) ??
  null

const dir = mkdtempSync(join(tmpdir(), 'sb-eval-'))
const db = openDatabase(join(dir, 'eval.db'))
db.settings.update({
  provider,
  openaiBaseUrl: process.env['OPENAI_BASE_URL'] ?? DEFAULT_SETTINGS.openaiBaseUrl
})
const library = createPdfLibrary(
  { rootDir: join(dir, 'library'), chunk: DEFAULT_CHUNK_OPTIONS },
  { inWorker: false }
)
const settings = {
  ...DEFAULT_SETTINGS,
  provider,
  openaiBaseUrl: process.env['OPENAI_BASE_URL'] ?? DEFAULT_SETTINGS.openaiBaseUrl
}
const ai = createStudyAi(
  createProvider(
    settings,
    { apiKey },
    { pdfText: (path) => library.pageTexts(path), codexWorkDir: join(dir, 'codex') }
  )
)
const queue = createJobQueue({ repo: db.jobs, concurrency: 3 })
const noKey = { getApiKey: () => null, setApiKey: () => undefined }
const pipelines = createPipelines({
  db,
  library,
  queue,
  srs: createSrs(),
  aiFor: () => ai,
  secrets: { getApiKey: () => apiKey, setApiKey: () => undefined },
  openAiSecrets: noKey,
  connections: {
    claude: createClaudeAuth({ executable: () => null }),
    listModels: async () => [],
    codex: createCodexAuth({ executable: () => null })
  },
  emit: (event, payload) => {
    if (event === 'ai.rateLimited' && payload) console.warn('rate limited:', payload)
  },
  now: () => new Date(),
  pickPdfs: async () => [],
  appInfo: { version: 'eval', platform: process.platform, dataDir: dir },
  portal: createDetachedPortal()
})
const h = pipelines.handlers
pipelines.start()

const t0 = Date.now()
const secs = (since: number): string => `${((Date.now() - since) / 1000).toFixed(1)} s`
const TRIVIA = /\b(slide\s*\d+|page\s*\d+|OP\d|W\d+\s*•|lecturer|course code)\b/i

async function idle(label: string): Promise<void> {
  const start = Date.now()
  for (;;) {
    const jobs = await h['jobs.list']({ docId: null })
    const active = jobs.filter((j) => j.state === 'queued' || j.state === 'running' || j.state === 'paused')
    const failed = jobs.filter((j) => j.state === 'failed')
    if (active.length === 0) {
      console.info(`${label}: done in ${secs(start)}${failed.length ? `, ${failed.length} FAILED` : ''}`)
      for (const f of failed) console.info(`   failed ${f.kind} ${f.label}: ${f.error}`)
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }
}

function gateItems(kind: string, items: (Card | Question)[], from: number, to: number): void {
  const inRange = items.filter((i) => i.sourcePages.every((p) => p >= from && p <= to)).length
  const verified = items.filter((i) => i.verification === 'verified').length
  const na = items.filter((i) => i.verification === 'not_applicable').length
  const trivia = items.filter((i) => TRIVIA.test('front' in i ? i.front : i.stem)).length
  console.info(
    `   ${kind}: ${items.length} items · pages in scope ${inRange}/${items.length} · evidence verified ${verified}/${items.length - na} (image-only ${na}) · trivia ${trivia}`
  )
}

try {
  const [doc] = await h['library.import']({ paths: [pdf] })
  if (!doc) throw new Error('import returned nothing')
  console.info(`import: "${doc.title}", ${doc.pageCount} pages in ${secs(t0)}`)
  await idle('index + course map')
  const status = await h['index.status']({ docId: doc.id })
  console.info(`   indexed ${status.indexedPages}/${status.totalPages}`)

  const topics = await h['topics.list']({ docId: doc.id })
  console.info(`course map: ${topics.length} topics`)
  for (const t of topics.slice(0, 40)) {
    const e = t.estimates
    console.info(
      `   ${t.parentId ? '  ' : ''}${t.title} [p${t.pageStart}-${t.pageEnd}]${e ? ` w=${(e.examWeight * 100).toFixed(0)}% d=${e.difficulty} core=${e.coreMinutes}m full=${e.fullMinutes}m cf=${e.coreFraction.toFixed(2)}` : ''}`
    )
  }

  const plan = await h['plan.save']({
    docId: doc.id,
    input: {
      examDate: null,
      totalHours: Number(values.hours),
      hoursPerDay: 2,
      targetScore: 0.75,
      mode: 'max_score',
      format: 'mixed',
      overrides: []
    }
  })
  console.info(`plan (${values.hours} h): expected ${(plan.result.expectedScore * 100).toFixed(0)}%`)
  for (const i of plan.result.items) {
    const title = topics.find((t) => t.id === i.topicId)?.title ?? i.topicId
    console.info(`   ${i.level.padEnd(4)} ${String(i.minutes).padStart(4)}m  ${title}: ${i.reason}`)
  }
  for (const n of plan.result.notes) console.info(`   note: ${n}`)

  const leaf = topics.find((t) => t.estimates && !topics.some((c) => c.parentId === t.id))
  if (leaf) {
    const t1 = Date.now()
    await h['cards.generate']({
      scope: { kind: 'topic', docId: doc.id, topicId: leaf.id },
      essentialsOnly: true,
      count: null
    })
    await idle(`essentials cards for "${leaf.title}"`)
    const cards = await h['cards.list']({
      scope: { kind: 'topic', docId: doc.id, topicId: leaf.id },
      includeInactive: false
    })
    console.info(`   generated in ${secs(t1)}`)
    gateItems('cards', cards, leaf.pageStart, leaf.pageEnd)
    for (const c of cards.slice(0, 4))
      console.info(
        `     Q: ${c.front.replace(/\s+/g, ' ')}\n     A: ${c.back.replace(/\s+/g, ' ').slice(0, 160)}`
      )
  }

  const page = Number(values.page)
  const t2 = Date.now()
  const session = await h['quiz.pageCheck']({ docId: doc.id, page })
  console.info(`page check p${page}: ${session.questions.length} questions in ${secs(t2)}`)
  gateItems('questions', session.questions, page - 1, page)
  for (const q of session.questions) console.info(`     [${q.type}] ${q.stem.replace(/\s+/g, ' ')}`)

  const usage = await h['usage.summary']({})
  console.info(
    `usage: $${usage.monthUsd.toFixed(3)}${usage.notional ? ' (notional, subscription)' : ''}; total ${secs(t0)}`
  )
} catch (err) {
  console.error('EVAL FAILED:', err)
  process.exitCode = 1
} finally {
  await pipelines.stop()
  db.close()
}
