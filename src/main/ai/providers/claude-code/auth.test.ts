import { EventEmitter } from 'node:events'
import { createClaudeAuth, loginUrl, NOT_INSTALLED, parseStatus, plainText, type AuthProcess } from './auth'

/** A scripted CLI process: `script` runs once listeners are attached and gets the process to drive. */
class FakeProcess extends EventEmitter implements AuthProcess {
  stdout = new EventEmitter()
  stderr = new EventEmitter()
  written: string[] = []
  killed = false
  onWrite: ((text: string) => void) | null = null
  stdin = {
    write: (text: string) => {
      this.written.push(text)
      this.onWrite?.(text)
      return true
    },
    end: () => undefined
  }
  kill(): boolean {
    this.killed = true
    this.emit('exit', null)
    return true
  }
  print(text: string): void {
    this.stdout.emit('data', Buffer.from(text))
  }
  exit(code: number): void {
    this.emit('exit', code)
  }
}

const STATUS_IN = JSON.stringify({
  loggedIn: true,
  authMethod: 'claude.ai',
  apiProvider: 'firstParty',
  email: 'student@example.com',
  subscriptionType: 'pro'
})
const URL = 'https://claude.com/cai/oauth/authorize?code=true&client_id=abc&state=xyz'

function harness(handlers: Record<string, (p: FakeProcess) => void>) {
  const calls: string[][] = []
  const spawn = (_exe: string, args: string[]): AuthProcess => {
    calls.push(args)
    const p = new FakeProcess()
    const handler = handlers[args.slice(0, 2).join(' ')]
    queueMicrotask(() => handler?.(p))
    return p
  }
  return { calls, auth: createClaudeAuth({ executable: () => '/usr/bin/claude', spawn, timeoutMs: 200 }) }
}

describe('output parsing', () => {
  it('strips colours and OSC 8 links and finds the sign-in URL', () => {
    const out = `Opening browser to sign in…\nIf the browser didn't open, visit: \u001b]8;;${URL}\u0007${URL}\u001b]8;;\u0007\n\u001b[1mPaste code here\u001b[0m > `
    expect(loginUrl(out)).toBe(URL)
    expect(plainText(out)).not.toContain('\u001b')
    expect(loginUrl('Opening browser…')).toBeNull()
  })

  it('maps the status JSON', () => {
    expect(parseStatus(STATUS_IN)).toEqual({
      installed: true,
      loggedIn: true,
      method: 'claude.ai',
      email: 'student@example.com',
      plan: 'pro',
      problem: null
    })
    expect(parseStatus('{"loggedIn": false}')).toMatchObject({ loggedIn: false, email: null })
    expect(parseStatus('boom')).toMatchObject({ loggedIn: false, problem: expect.stringContaining('boom') })
  })
})

describe('createClaudeAuth', () => {
  it('reports a missing CLI without spawning anything', async () => {
    const auth = createClaudeAuth({
      executable: () => null,
      spawn: () => {
        throw new Error('no spawn')
      }
    })
    expect(await auth.status()).toMatchObject({ installed: false, problem: NOT_INSTALLED })
    await expect(auth.login('claudeai')).rejects.toMatchObject({ kind: 'unavailable' })
  })

  it('reads the status even when the CLI exits non-zero', async () => {
    const { auth } = harness({
      'auth status': (p) => {
        p.print('{"loggedIn": false}')
        p.exit(1)
      }
    })
    expect(await auth.status()).toMatchObject({ installed: true, loggedIn: false })
  })

  it('signs in: URL first, then the pasted code, then the new status', async () => {
    let login: FakeProcess | null = null
    const { auth, calls } = harness({
      'auth login': (p) => {
        login = p
        p.print(
          `Opening browser to sign in…\nIf the browser didn't open, visit: ${URL}\nPaste code here if prompted > `
        )
        p.onWrite = (text) => {
          if (text === 'the-code#state\n') p.exit(0)
        }
      },
      'auth status': (p) => {
        p.print(STATUS_IN)
        p.exit(0)
      }
    })
    expect(await auth.login('claudeai')).toEqual({ url: URL })
    expect(calls[0]).toEqual(['auth', 'login', '--claudeai'])
    expect(await auth.submitCode('  the-code#state ')).toMatchObject({ loggedIn: true, plan: 'pro' })
    expect(login).not.toBeNull()
    // The session is over: a second code has nowhere to go.
    await expect(auth.submitCode('again')).rejects.toMatchObject({ kind: 'auth' })
  })

  it('accepts a CLI that finished on its own before the code was pasted', async () => {
    const { auth } = harness({
      'auth login': (p) => {
        p.print(`visit: ${URL}\n`)
        setTimeout(() => p.exit(0), 5)
      },
      'auth status': (p) => {
        p.print(STATUS_IN)
        p.exit(0)
      }
    })
    await auth.login('console')
    await new Promise((r) => setTimeout(r, 20))
    expect(await auth.submitCode('')).toMatchObject({ loggedIn: true })
  })

  it('surfaces a rejected code', async () => {
    const { auth } = harness({
      'auth login': (p) => {
        p.print(`visit: ${URL}\n`)
        p.onWrite = () => {
          p.print('\nError: Invalid code\n')
          p.exit(1)
        }
      }
    })
    await auth.login('claudeai')
    await expect(auth.submitCode('bad')).rejects.toMatchObject({
      kind: 'auth',
      message: expect.stringContaining('Invalid code')
    })
  })

  it('a new sign-in cancels the unfinished one', async () => {
    const started: FakeProcess[] = []
    const { auth } = harness({
      'auth login': (p) => {
        started.push(p)
        p.print(`visit: ${URL}\n`)
      }
    })
    await auth.login('claudeai')
    await auth.login('claudeai')
    expect(started[0]?.killed).toBe(true)
    auth.cancelLogin()
    expect(started[1]?.killed).toBe(true)
  })

  it('signs out and reports the new state', async () => {
    const { auth, calls } = harness({
      'auth logout': (p) => p.exit(0),
      'auth status': (p) => {
        p.print('{"loggedIn": false}')
        p.exit(1)
      }
    })
    expect(await auth.logout()).toMatchObject({ loggedIn: false })
    expect(calls.map((c) => c.join(' '))).toEqual(['auth logout', 'auth status --json'])
  })
})
