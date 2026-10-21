import { spawn as nodeSpawn } from 'node:child_process'
import type { CodexAccount, CodexLoginStart } from '@shared/ai/connections'
import { AiError } from '@shared/ai/provider'
import { plainText } from '../claude-code/auth'
import { CODEX_NOT_INSTALLED } from './provider'

/**
 * Codex's own sign-in, driven from the app: `codex login status`, `codex login --device-auth` and
 * `codex logout`. Device sign-in prints a page and a one-time code; the student enters the code
 * there and the CLI finishes on its own. Credentials stay with Codex; the app never sees them.
 */

/** The subset of a child process used here; injectable so tests need no real CLI. */
export interface CodexAuthProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (err: Error) => void): unknown
  kill(): unknown
}
export type SpawnCodexAuthFn = (executable: string, args: string[]) => CodexAuthProcess

export interface CodexAuth {
  status(): Promise<CodexAccount>
  /** Starts a device sign-in (an unfinished one is cancelled); resolves once the code is shown. */
  login(): Promise<CodexLoginStart>
  /** Waits for the device sign-in to finish (the student entered the code), then the new state. */
  waitForLogin(): Promise<CodexAccount>
  cancelLogin(): void
  /** Signs Codex out on this computer (the terminal `codex` too). */
  logout(): Promise<CodexAccount>
}

const defaultSpawn: SpawnCodexAuthFn = (executable, args) =>
  nodeSpawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })

/** `codex login status` output: "Logged in using ChatGPT", "Logged in using an API key", "Not logged in". */
export function parseCodexStatus(output: string): CodexAccount {
  const text = plainText(output)
  const match = /Logged in using (?:an? )?(ChatGPT|API key)/i.exec(text)
  if (match?.[1])
    return {
      installed: true,
      loggedIn: true,
      method: /chatgpt/i.test(match[1]) ? 'ChatGPT' : 'API key',
      problem: null
    }
  if (/not logged in/i.test(text)) return { installed: true, loggedIn: false, method: null, problem: null }
  return {
    installed: true,
    loggedIn: false,
    method: null,
    problem: `Could not read the Codex sign-in state: ${text.trim().slice(0, 200) || 'no output'}`
  }
}

/** The device page and one-time code from `codex login --device-auth`, once both are printed. */
export function deviceCode(output: string): CodexLoginStart | null {
  const text = plainText(output)
  const url = /https:\/\/\S*device\S*/.exec(text)?.[0]
  const code = /\b([A-Z0-9]{4}-[A-Z0-9]{4,6})\b/.exec(text)?.[1]
  return url && code ? { url, code } : null
}

export function createCodexAuth(deps: {
  executable(): string | null
  spawn?: SpawnCodexAuthFn
  timeoutMs?: number
}): CodexAuth {
  const spawn = deps.spawn ?? defaultSpawn
  const timeoutMs = deps.timeoutMs ?? 20_000
  const notInstalled: CodexAccount = {
    installed: false,
    loggedIn: false,
    method: null,
    problem: CODEX_NOT_INSTALLED
  }
  let session: { proc: CodexAuthProcess; exited: Promise<number | null> } | null = null

  const run = (args: string[]): Promise<string> => {
    const exe = deps.executable()
    if (exe === null)
      return Promise.reject(new AiError('unavailable', CODEX_NOT_INSTALLED, { retryable: false }))
    return new Promise((resolve, reject) => {
      const proc = spawn(exe, args)
      let output = ''
      const add = (c: Buffer | string): void => {
        output += c.toString()
      }
      proc.stdout.on('data', add)
      proc.stderr.on('data', add)
      const timer = setTimeout(() => {
        proc.kill()
        reject(new AiError('unavailable', 'Codex did not answer in time'))
      }, timeoutMs)
      proc.once('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
      proc.once('exit', () => {
        clearTimeout(timer)
        resolve(output)
      })
    })
  }

  async function status(): Promise<CodexAccount> {
    if (deps.executable() === null) return notInstalled
    try {
      return parseCodexStatus(await run(['login', 'status']))
    } catch (err) {
      return {
        installed: true,
        loggedIn: false,
        method: null,
        problem: err instanceof Error ? err.message : String(err)
      }
    }
  }

  const cancelLogin = (): void => {
    session?.proc.kill()
    session = null
  }

  return {
    status,
    cancelLogin,

    async login() {
      cancelLogin()
      const exe = deps.executable()
      if (exe === null) throw new AiError('unavailable', CODEX_NOT_INSTALLED, { retryable: false })
      const proc = spawn(exe, ['login', '--device-auth'])
      let output = ''
      const exited = new Promise<number | null>((resolve) => {
        proc.once('exit', resolve)
        proc.once('error', () => resolve(null))
      })
      session = { proc, exited }
      return new Promise<CodexLoginStart>((resolve, reject) => {
        const timer = setTimeout(() => {
          cancelLogin()
          reject(new AiError('unavailable', 'Codex did not show a sign-in code in time'))
        }, timeoutMs)
        const add = (c: Buffer | string): void => {
          output += c.toString()
          const found = deviceCode(output)
          if (found) {
            clearTimeout(timer)
            resolve(found)
          }
        }
        proc.stdout.on('data', add)
        proc.stderr.on('data', add)
        void exited.then((code) => {
          clearTimeout(timer)
          if (!deviceCode(output))
            reject(
              new AiError(
                'unavailable',
                `Codex sign-in stopped (exit ${String(code)}): ${plainText(output).trim().slice(-200)}`
              )
            )
        })
      })
    },

    async waitForLogin() {
      const current = session
      if (!current) return status()
      // The code is valid for 15 minutes.
      await Promise.race([current.exited, new Promise((resolve) => setTimeout(resolve, 16 * 60_000))])
      if (session === current) session = null
      return status()
    },

    async logout() {
      cancelLogin()
      if (deps.executable() === null) return notInstalled
      await run(['logout']).catch(() => '')
      return status()
    }
  }
}
