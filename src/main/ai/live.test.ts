import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PDFDocument } from 'pdf-lib'
import { z } from 'zod'
import { DEFAULT_SETTINGS } from '@shared/settings'
import { makeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { createClaudeCodeProvider } from './providers/claude-code/provider'
import { createStudyAi } from './study-ai'

/**
 * Live checks against the user's Claude subscription (claude-code provider only; the API
 * provider is never called live). Skipped unless LIVE=1. Inputs are tiny because the quota is
 * shared: run one test at a time with -t when possible. Vitest hides console output of passing
 * tests, so add --silent=false to see the latency and cost lines:
 *   LIVE=1 npm test -- src/main/ai/live -t "tiny" --silent=false
 */

const live = process.env['LIVE'] === '1'
const provider = createClaudeCodeProvider({
  models: DEFAULT_SETTINGS.models['claude-code'],
  executablePath: DEFAULT_SETTINGS.claudeCodePath
})

describe.skipIf(!live)('live: claude-code provider', () => {
  it('tiny text-only structured call', { timeout: 120_000 }, async () => {
    const started = Date.now()
    const res = await provider.generate({
      task: 'health',
      system: 'Answer with the requested JSON only.',
      parts: [{ type: 'text', text: 'What is 2 + 3? Put the number in "sum".' }],
      schema: z.strictObject({ sum: z.number() }),
      tier: 'fast',
      effort: 'low'
    })
    console.info(
      `[live] tiny call: ${Date.now() - started} ms, model ${res.model}, notional $${res.usage.costUsd}`
    )
    expect(res.data.sum).toBe(5)
    expect(res.usage.notional).toBe(true)
  })

  it('indexes a 2-page chunk built from the fixture', { timeout: 180_000 }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'sb-live-'))
    try {
      const source = await PDFDocument.load(await makeFixturePdf())
      const out = await PDFDocument.create()
      for (const page of await out.copyPages(source, [0, 1])) out.addPage(page)
      const bytes = await out.save()
      const path = join(dir, 'chunk.pdf')
      await writeFile(path, bytes)
      const text: Record<number, string> = {
        1: 'Fixture Course: Optical Links Study notes for automated tests',
        2: 'Total internal reflection Light stays inside the fibre core because the core refractive index n1 is higher than the cladding index n2.'
      }
      const started = Date.now()
      const res = await createStudyAi(provider).indexChunk({
        chunk: { index: 0, startPage: 1, endPage: 2, path, bytes: bytes.length },
        pageText: (p) => text[p] ?? ''
      })
      console.info(`[live] index 2 pages: ${Date.now() - started} ms, $${res.usage[0]?.usage.costUsd}`)
      expect(res.value.pages.map((p) => p.page)).toEqual([1, 2])
      expect(res.value.missingPages).toEqual([])
      expect(res.value.language).toBe('en')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
