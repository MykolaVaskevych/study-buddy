import { spawn as nodeSpawn } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { z } from 'zod'
import {
  AiError,
  type Effort,
  type GenerateRequest,
  type GenerateResult,
  type HealthResult,
  type LlmProvider,
  type ModelTier,
  type PromptPart,
  type StreamEvent,
  type StreamRequest
} from '@shared/ai/provider'
import { documentText, extractJson, TEXT_ONLY_NOTE } from '../openai-compatible/wire'
import type { PdfTextFn } from '../openai-compatible/provider'
import { codexArgs, codexError, parseEvents, PLAIN_MODEL_NOTE } from './exec'

/**
 * Codex (OpenAI's CLI) as a provider: the student's ChatGPT plan, like Claude Code for a Claude
 * plan. Each call is one `codex exec` in an empty folder with a read-only sandbox, ephemeral, without
 * the user's config; structured output uses `--output-schema`. Codex is given text: PDF parts
 * become their text layer with SB-PAGE markers (image-only slides are flagged), as for local models.
 */

/** The subset of a child process used here; injectable so tests need no real CLI. */
export interface CodexProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stdin: { write(text: string): unknown; end(): unknown }
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (err: NodeJS.ErrnoException) => void): unknown
  kill(): unknown
}
export type SpawnCodexFn = (executable: string, args: string[], cwd: string) => CodexProcess

export interface CodexConfig {
  /** Null when Codex is not installed: every call fails with a clear message. */
  executable: string | null
  models: Record<ModelTier, string>
}

export interface CodexDeps {
  pdfText: PdfTextFn
  /** Where each call gets its empty working folder (host-visible in the Flatpak). */
  workDir: string
  spawn?: SpawnCodexFn
  timeoutMs?: number
  now?: () => number
}

export const CODEX_NOT_INSTALLED =
  'Codex was not found on this computer. Install it (npm install -g @openai/codex), then sign in here.'

const DEFAULT_TIMEOUT_MS = 10 * 60_000

const defaultSpawn: SpawnCodexFn = (executable, args, cwd) =>
  nodeSpawn(executable, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

export function createCodexProvider(config: CodexConfig, deps: CodexDeps): LlmProvider {
  const spawn = deps.spawn ?? defaultSpawn
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const now = deps.now ?? Date.now

  async function promptOf(system: string, parts: readonly PromptPart[]): Promise<string> {
    const out: string[] = []
    let hasPdf = false
    for (const part of parts) {
      if (part.type === 'text') {
        out.push(part.text)
        continue
      }
      hasPdf = true
      try {
        out.push(documentText(await deps.pdfText(part.path), part.title ?? null))
      } catch (cause) {
        throw new AiError('unknown', `Cannot read PDF part ${basename(part.path)}`, {
          retryable: false,
          cause
        })
      }
    }
    return [PLAIN_MODEL_NOTE, system, ...(hasPdf ? [TEXT_ONLY_NOTE] : []), out.join('\n\n')].join('\n\n')
  }

  /** One `codex exec`; resolves with the final message. */
  async function exec(
    prompt: string,
    opts: { tier: ModelTier; effort: Effort; schema: Record<string, unknown> | null; signal?: AbortSignal }
  ): Promise<{ text: string; usage: ReturnType<typeof parseEvents>['usage']; model: string }> {
    const executable = config.executable
    if (executable === null) throw new AiError('unavailable', CODEX_NOT_INSTALLED, { retryable: false })
    if (opts.signal?.aborted) throw new AiError('cancelled', 'Cancelled')
    await mkdir(deps.workDir, { recursive: true })
    const dir = await mkdtemp(join(deps.workDir, 'call-'))
    const model = config.models[opts.tier]
    try {
      const schemaPath = opts.schema ? join(dir, 'schema.json') : null
      if (schemaPath) await writeFile(schemaPath, JSON.stringify(opts.schema))
      const outPath = join(dir, 'answer.txt')
      const args = codexArgs({ model, effort: opts.effort, schemaPath, outPath })
      const { code, stdout, stderr } = await new Promise<{
        code: number | null
        stdout: string
        stderr: string
      }>((resolve, reject) => {
        const proc = spawn(executable, args, dir)
        let stdout = ''
        let stderr = ''
        proc.stdout.on('data', (c) => {
          stdout += c.toString()
        })
        proc.stderr.on('data', (c) => {
          stderr = (stderr + c.toString()).slice(-4000)
        })
        const stop = (err: AiError): void => {
          proc.kill()
          reject(err)
        }
        const timer = setTimeout(
          () => stop(new AiError('unavailable', 'Codex did not answer in time')),
          timeoutMs
        )
        const onAbort = (): void => stop(new AiError('cancelled', 'Cancelled'))
        opts.signal?.addEventListener('abort', onAbort, { once: true })
        proc.once('error', (err) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          reject(
            err.code === 'ENOENT'
              ? new AiError('unavailable', CODEX_NOT_INSTALLED, { retryable: false })
              : new AiError('unavailable', `Codex could not start: ${err.message}`, { cause: err })
          )
        })
        proc.once('exit', (exitCode) => {
          clearTimeout(timer)
          opts.signal?.removeEventListener('abort', onAbort)
          resolve({ code: exitCode, stdout, stderr })
        })
        proc.stdin.write(prompt)
        proc.stdin.end()
      })
      const run = parseEvents(stdout)
      if (run.error !== null || code !== 0) throw codexError(run.error ?? `exit code ${String(code)}`, stderr)
      const text = await readFile(outPath, 'utf8').catch(() => '')
      if (text.trim() === '') throw new AiError('invalid_output', 'Codex returned no answer')
      return { text, usage: run.usage, model }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  async function generate<T>(req: GenerateRequest<T>): Promise<GenerateResult<T>> {
    const schema = z.toJSONSchema(req.schema, { io: 'input', unrepresentable: 'any' }) as Record<
      string,
      unknown
    >
    const result = await exec(await promptOf(req.system, req.parts), {
      tier: req.tier,
      effort: req.effort ?? 'medium',
      schema,
      ...(req.signal ? { signal: req.signal } : {})
    })
    // Throws AiError('invalid_output') when the answer holds no JSON.
    const json = extractJson(result.text)
    const parsed = req.schema.safeParse(json)
    if (!parsed.success)
      throw new AiError(
        'invalid_output',
        `Codex returned the wrong shape: ${parsed.error.message.slice(0, 300)}`
      )
    return { data: parsed.data, usage: result.usage, model: result.model }
  }

  return {
    id: 'codex',
    capabilities: { promptCaching: false, batch: false, maxPdfPages: 100 },
    generate,

    async *stream(req: StreamRequest): AsyncIterable<StreamEvent> {
      // `codex exec` gives the answer at the end, so it arrives as one piece.
      const result = await exec(await promptOf(req.system, req.parts), {
        tier: req.tier,
        effort: 'medium',
        schema: null,
        ...(req.signal ? { signal: req.signal } : {})
      })
      yield { type: 'text', text: result.text }
      yield { type: 'done', usage: result.usage, model: result.model }
    },

    async health(signal?: AbortSignal): Promise<HealthResult> {
      const started = now()
      try {
        const res = await generate({
          task: 'health',
          system: 'This is a connectivity check. Answer with ok = true.',
          parts: [{ type: 'text', text: 'Connectivity check: set ok to true.' }],
          schema: z.strictObject({ ok: z.boolean() }),
          tier: 'fast',
          effort: 'low',
          signal: AbortSignal.any([AbortSignal.timeout(180_000), ...(signal ? [signal] : [])])
        })
        const latencyMs = now() - started
        return {
          ok: true,
          provider: 'codex',
          model: res.model,
          latencyMs,
          message: `Codex answered (${res.model}, ${latencyMs} ms).`
        }
      } catch (err) {
        return {
          ok: false,
          provider: 'codex',
          model: null,
          latencyMs: null,
          message: err instanceof Error ? err.message : String(err)
        }
      }
    }
  }
}
