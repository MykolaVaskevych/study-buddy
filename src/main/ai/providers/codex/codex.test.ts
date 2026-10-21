import { EventEmitter } from 'node:events'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod'
import { AiError } from '@shared/ai/provider'
import { createCodexAuth, deviceCode, parseCodexStatus, type CodexAuthProcess } from './auth'
import { codexArgs, codexError, parseEvents } from './exec'
import { findCodexExecutable } from './locate'
import { createCodexProvider, type CodexProcess } from './provider'

/** A stand-in for the codex CLI: prints `stdout`, writes `answer` to the -o file, exits with `code`. */
function fakeCodex(run: { answer?: string; stdout: string; code?: number }) {
  const calls: { args: string[]; cwd: string; stdin: string }[] = []
  const spawn = (_exe: string, args: string[], cwd: string): CodexProcess => {
    const call = { args, cwd, stdin: '' }
    calls.push(call)
    const proc = new EventEmitter()
    const out = new EventEmitter()
    const err = new EventEmitter()
    const stdin = {
      write: (t: string) => {
        call.stdin += t
      },
      end: () => {
        void (async () => {
          const o = args.indexOf('-o')
          if (run.answer !== undefined && o >= 0) await writeFile(args[o + 1] ?? '', run.answer)
          out.emit('data', Buffer.from(run.stdout))
          proc.emit('exit', run.code ?? 0)
        })()
      }
    }
    return Object.assign(proc, {
      stdout: out,
      stderr: err,
      stdin,
      kill: () => proc.emit('exit', null)
    }) as unknown as CodexProcess
  }
  return { spawn, calls }
}

const done =
  '{"type":"turn.completed","usage":{"input_tokens":120,"cached_input_tokens":20,"output_tokens":30}}\n'

describe('codex exec', () => {
  it('runs read-only, ephemeral, without the user config, with the schema and effort', () => {
    expect(
      codexArgs({ model: 'gpt-6-luna', effort: 'low', schemaPath: '/w/s.json', outPath: '/w/a.txt' })
    ).toEqual([
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--ephemeral',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox',
      'read-only',
      '-m',
      'gpt-6-luna',
      '-c',
      'model_reasoning_effort="low"',
      '--output-schema',
      '/w/s.json',
      '-o',
      '/w/a.txt',
      '-'
    ])
  })

  it('reads usage and failures from the event stream', () => {
    expect(parseEvents(`{"type":"thread.started"}\n${done}`)).toEqual({
      usage: {
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 20,
        cacheWriteTokens: 0,
        costUsd: null,
        notional: true
      },
      error: null
    })
    const failed = parseEvents(
      '{"type":"error","message":"Reconnecting... 1/5 (x)"}\n{"type":"turn.failed","error":{"message":"workspace routing discovery unauthorized (401)"}}\n'
    )
    expect(failed.error).toBe('workspace routing discovery unauthorized (401)')
  })

  it('explains sign-in and usage-limit failures', () => {
    expect(codexError('workspace routing discovery unauthorized (401)')).toMatchObject({
      kind: 'auth',
      retryable: false
    })
    expect(
      codexError('x', 'Your access token could not be refreshed. Please log out and sign in again.').kind
    ).toBe('auth')
    expect(codexError("You've hit your usage limit. Try again at 2026-10-22T18:00:00Z.")).toMatchObject({
      kind: 'rate_limited',
      resetAt: '2026-10-22T18:00:00.000Z'
    })
    expect(codexError('boom').kind).toBe('unavailable')
  })

  it('finds the CLI on PATH or in the usual places, and the Flatpak wrapper', () => {
    expect(findCodexExecutable({ PATH: '/opt/x' }, (p) => p === '/opt/x/codex', '/home/u', 'linux')).toBe(
      '/opt/x/codex'
    )
    expect(
      findCodexExecutable({ PATH: '' }, (p) => p === '/home/u/.local/bin/codex', '/home/u', 'linux')
    ).toBe('/home/u/.local/bin/codex')
    expect(findCodexExecutable({ FLATPAK_ID: 'x' }, (p) => p === '/app/bin/codex-host', '/h', 'linux')).toBe(
      '/app/bin/codex-host'
    )
    expect(findCodexExecutable({ PATH: '' }, () => false, '/h', 'linux')).toBeNull()
  })
})

describe('codex provider', () => {
  const workDir = join(tmpdir(), 'sb-codex-test')
  const pdfText = async () => [{ page: 4, text: 'Fibre attenuation is 0.2 dB/km.', hasTextLayer: true }]

  it('generates structured output: prompt on stdin, schema file, model per tier, usage', async () => {
    const codex = fakeCodex({ answer: '{"answer":"0.2 dB/km"}', stdout: done })
    const provider = createCodexProvider(
      { executable: '/usr/bin/codex', models: { fast: 'gpt-6-luna', smart: 'gpt-6.1-sol' } },
      { pdfText, workDir, spawn: codex.spawn }
    )
    const res = await provider.generate({
      task: 'cards',
      system: 'Write a card.',
      parts: [
        { type: 'pdf', path: '/lib/chunk.pdf', title: 'Optics' },
        { type: 'text', text: 'Focus pages: 4' }
      ],
      schema: z.strictObject({ answer: z.string() }),
      tier: 'smart',
      effort: 'high'
    })
    expect(res).toMatchObject({
      data: { answer: '0.2 dB/km' },
      model: 'gpt-6.1-sol',
      usage: { inputTokens: 120, notional: true }
    })
    const [call] = codex.calls
    expect(call?.args).toEqual(
      expect.arrayContaining(['-m', 'gpt-6.1-sol', 'model_reasoning_effort="high"', '--output-schema'])
    )
    expect(call?.stdin).toContain('Do not run commands')
    expect(call?.stdin).toContain('[SB-PAGE 4]\nFibre attenuation is 0.2 dB/km.')
    expect(call?.cwd.startsWith(workDir)).toBe(true)
    const schemaPath = call?.args[call.args.indexOf('--output-schema') + 1] ?? ''
    // The call's folder is removed afterwards.
    await expect(readFile(schemaPath)).rejects.toThrow()
  })

  it('fails clearly when Codex is missing, signed out, or answers the wrong shape', async () => {
    const make = (codex: ReturnType<typeof fakeCodex>, executable: string | null = '/usr/bin/codex') =>
      createCodexProvider(
        { executable, models: { fast: 'a', smart: 'b' } },
        { pdfText, workDir, spawn: codex.spawn }
      )
    const req = {
      task: 'health' as const,
      system: 's',
      parts: [{ type: 'text' as const, text: 'x' }],
      schema: z.strictObject({ ok: z.boolean() }),
      tier: 'fast' as const
    }
    await expect(make(fakeCodex({ stdout: '' }), null).generate(req)).rejects.toMatchObject({
      kind: 'unavailable'
    })
    await expect(
      make(
        fakeCodex({ stdout: '{"type":"turn.failed","error":{"message":"401 unauthorized"}}\n', code: 1 })
      ).generate(req)
    ).rejects.toMatchObject({ kind: 'auth' })
    const wrong = await make(fakeCodex({ answer: '{"ok":"yes"}', stdout: done }))
      .generate(req)
      .catch((e: unknown) => e)
    expect(wrong).toBeInstanceOf(AiError)
    expect(wrong).toMatchObject({ kind: 'invalid_output' })
  })
})

describe('codex sign-in', () => {
  it('reads the login state and the device code', () => {
    expect(parseCodexStatus('Logged in using ChatGPT\n')).toEqual({
      installed: true,
      loggedIn: true,
      method: 'ChatGPT',
      problem: null
    })
    expect(parseCodexStatus('Logged in using an API key - sk-...')).toMatchObject({
      loggedIn: true,
      method: 'API key'
    })
    expect(parseCodexStatus('Not logged in')).toMatchObject({ loggedIn: false, problem: null })
    expect(
      deviceCode(
        '1. Open this link\n   \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\n2. Enter this one-time code\n   \u001b[94mA57V-Z4QTF\u001b[0m'
      )
    ).toEqual({ url: 'https://auth.openai.com/codex/device', code: 'A57V-Z4QTF' })
  })

  it('shows the code, then waits for the CLI to finish and reports the new state', async () => {
    let loggedIn = false
    let finishLogin: () => void = () => undefined
    const spawn = (_exe: string, args: string[]): CodexAuthProcess => {
      const proc = new EventEmitter()
      const out = new EventEmitter()
      const err = new EventEmitter()
      setTimeout(() => {
        if (args.join(' ') === 'login status') {
          out.emit('data', loggedIn ? 'Logged in using ChatGPT' : 'Not logged in')
          proc.emit('exit', loggedIn ? 0 : 1)
        } else if (args[1] === '--device-auth') {
          out.emit('data', 'https://auth.openai.com/codex/device\n')
          out.emit('data', 'ABCD-EFGHI\n')
          finishLogin = () => {
            loggedIn = true
            proc.emit('exit', 0)
          }
        }
      }, 1)
      return Object.assign(proc, {
        stdout: out,
        stderr: err,
        kill: () => proc.emit('exit', null)
      }) as unknown as CodexAuthProcess
    }
    const auth = createCodexAuth({ executable: () => '/usr/bin/codex', spawn })
    expect((await auth.status()).loggedIn).toBe(false)
    expect(await auth.login()).toEqual({ url: 'https://auth.openai.com/codex/device', code: 'ABCD-EFGHI' })
    const waiting = auth.waitForLogin()
    finishLogin()
    expect(await waiting).toMatchObject({ loggedIn: true, method: 'ChatGPT' })
    expect(await createCodexAuth({ executable: () => null }).status()).toMatchObject({ installed: false })
  })
})
