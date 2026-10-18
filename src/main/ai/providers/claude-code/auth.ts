import { spawn as nodeSpawn } from 'node:child_process'
import type { ClaudeAccount, ClaudeLoginStart } from '@shared/ai/connections'
import { AiError } from '@shared/ai/provider'

/**
 * Claude Code's own login, driven from the app: `claude auth status --json`, `claude auth login`
 * and `claude auth logout`. Without a terminal, login opens the browser on the claude.ai sign-in
 * page, which then shows a one-time code; the CLI waits for that code on stdin. So login is two
 * steps here: start (returns the page URL, in case the browser did not open) and submit the code.
 * Credentials stay with Claude Code; the app never sees them.
 */

/** The subset of a child process used here; injectable so tests need no real CLI. */
export interface AuthProcess {
  stdout: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stderr: { on(event: 'data', listener: (chunk: Buffer | string) => void): unknown }
  stdin: { write(text: string): unknown; end(): unknown }
  once(event: 'exit', listener: (code: number | null) => void): unknown
  once(event: 'error', listener: (err: Error) => void): unknown
  kill(): unknown
}

export type SpawnAuthFn = (executable: string, args: string[]) => AuthProcess

export interface ClaudeAuth {
  status(): Promise<ClaudeAccount>
  /** Starts a sign-in; a previous unfinished one is cancelled. */
  login(method: 'claudeai' | 'console'): Promise<ClaudeLoginStart>
  /** Sends the code from the sign-in page and waits for the CLI to finish. */
  submitCode(code: string): Promise<ClaudeAccount>
  cancelLogin(): void
  /** Signs Claude Code out on this computer (the terminal `claude` too). */
  logout(): Promise<ClaudeAccount>
}

export interface ClaudeAuthDeps {
  /** Current executable (settings path or auto-detected); null when Claude Code is not installed. */
  executable(): string | null
  spawn?: SpawnAuthFn
  /** Wait for the sign-in URL to appear, and for short commands to finish. */
  timeoutMs?: number
}

export const NOT_INSTALLED =
  'Claude Code was not found on this computer. Install it (npm install -g @anthropic-ai/claude-code), then sign in here.'

const defaultSpawn: SpawnAuthFn = (executable, args) =>
  nodeSpawn(executable, args, { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })

/** Removes terminal escapes (colours, OSC 8 hyperlinks) from CLI output. */
// Terminal escapes are control characters by definition, which is what these patterns match.
/* eslint-disable no-control-regex */
const OSC = /\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g
const CSI = /\u001b\[[0-9;?]*[A-Za-z]/g
/* eslint-enable no-control-regex */

export function plainText(output: string): string {
  return output.replace(OSC, ' ').replace(CSI, '')
}

/** The sign-in URL in login output, if it has been printed yet. */
export function loginUrl(output: string): string | null {
  const match = /https:\/\/\S*oauth\/authorize\S*/.exec(plainText(output))
  return match ? match[0] : null
}

/** Maps `claude auth status --json` output; anything unreadable becomes a problem message. */
export function parseStatus(stdout: string): ClaudeAccount {
  const base: ClaudeAccount = {
    installed: true,
    loggedIn: false,
    method: null,
    email: null,
    plan: null,
    problem: null
  }
  let json: unknown
  try {
    json = JSON.parse(stdout.slice(stdout.indexOf('{')))
  } catch {
    return {
      ...base,
      problem: `Could not read the Claude Code login state: ${plainText(stdout).trim().slice(0, 200) || 'no output'}`
    }
  }
  const j = (json ?? {}) as Record<string, unknown>
  const str = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null)
  return {
    ...base,
    loggedIn: j['loggedIn'] === true,
    method: str(j['authMethod']),
    email: str(j['email']),
    plan: str(j['subscriptionType'])
  }
}

interface Finished {
  code: number | null
  output: string
}

/** Runs to completion, collecting stdout+stderr; kills it after `timeoutMs`. */
function runToEnd(proc: AuthProcess, timeoutMs: number): Promise<Finished> {
  return new Promise((resolve, reject) => {
    let output = ''
    const add = (chunk: Buffer | string): void => {
      output += chunk.toString()
    }
    proc.stdout.on('data', add)
    proc.stderr.on('data', add)
    const timer = setTimeout(() => {
      proc.kill()
      reject(new AiError('unavailable', 'Claude Code did not answer in time'))
    }, timeoutMs)
    proc.once('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
    proc.once('exit', (code) => {
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

interface Session {
  proc: AuthProcess
  output: () => string
  exited: Promise<number | null>
}

/** Writes the code (unless the CLI already finished on its own) and waits for the exit code. */
async function finish(current: Session, code: string, waitMs: number): Promise<number | null | 'timeout'> {
  const done = await Promise.race([current.exited, Promise.resolve('running' as const)])
  if (done !== 'running') return done
  current.proc.stdin.write(`${code.trim()}\n`)
  return Promise.race([
    current.exited,
    new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), waitMs))
  ])
}

export function createClaudeAuth(deps: ClaudeAuthDeps): ClaudeAuth {
  const spawn = deps.spawn ?? defaultSpawn
  const timeoutMs = deps.timeoutMs ?? 20_000
  let session: Session | null = null

  const notInstalled = (): ClaudeAccount => ({
    installed: false,
    loggedIn: false,
    method: null,
    email: null,
    plan: null,
    problem: NOT_INSTALLED
  })

  const executable = (): string => {
    const exe = deps.executable()
    if (exe === null) throw new AiError('unavailable', NOT_INSTALLED, { retryable: false })
    return exe
  }

  async function status(): Promise<ClaudeAccount> {
    const exe = deps.executable()
    if (exe === null) return notInstalled()
    try {
      // Exits non-zero when signed out, still printing the JSON.
      const { output } = await runToEnd(spawn(exe, ['auth', 'status', '--json']), timeoutMs)
      return parseStatus(output)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return notInstalled()
      const message = err instanceof Error ? err.message : String(err)
      return {
        ...notInstalled(),
        installed: true,
        problem: `Could not ask Claude Code for its login state: ${message}`
      }
    }
  }

  function cancelLogin(): void {
    session?.proc.kill()
    session = null
  }

  return {
    status,
    cancelLogin,

    async login(method) {
      cancelLogin()
      const proc = spawn(executable(), ['auth', 'login', method === 'console' ? '--console' : '--claudeai'])
      let output = ''
      const exited = new Promise<number | null>((resolve) => {
        proc.once('exit', resolve)
        proc.once('error', () => resolve(null))
      })
      const current: Session = { proc, output: () => output, exited }
      session = current
      return new Promise<ClaudeLoginStart>((resolve, reject) => {
        const timer = setTimeout(() => resolve({ url: loginUrl(output) }), timeoutMs)
        const onData = (chunk: Buffer | string): void => {
          output += chunk.toString()
          const url = loginUrl(output)
          if (url !== null) {
            clearTimeout(timer)
            resolve({ url })
          }
        }
        proc.stdout.on('data', onData)
        proc.stderr.on('data', onData)
        void exited.then((code) => {
          clearTimeout(timer)
          // Exiting before printing a URL means the CLI refused to start a login.
          if (loginUrl(output) === null)
            reject(
              new AiError(
                'auth',
                `Claude Code could not start the sign-in (exit ${code ?? '?'}): ${plainText(output).trim().slice(-300)}`
              )
            )
        })
      })
    },

    async submitCode(code) {
      const current = session
      if (current === null)
        throw new AiError('auth', 'No sign-in is in progress. Start it again.', { retryable: false })
      const exit = await finish(current, code, timeoutMs * 3)
      if (session === current) session = null
      if (exit === 'timeout') {
        current.proc.kill()
        throw new AiError('auth', 'Claude Code did not accept the code in time. Start the sign-in again.')
      }
      if (exit !== 0) {
        const tail = plainText(current.output()).trim().split('\n').slice(-2).join(' ')
        throw new AiError('auth', `Sign-in failed: ${tail || `exit ${exit ?? '?'}`}`)
      }
      return status()
    },

    async logout() {
      const { code, output } = await runToEnd(spawn(executable(), ['auth', 'logout']), timeoutMs)
      if (code !== 0) throw new AiError('auth', `Sign-out failed: ${plainText(output).trim().slice(-300)}`)
      return status()
    }
  }
}
