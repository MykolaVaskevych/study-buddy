import { describe, expect, it, vi } from 'vitest'
import { AiError } from '@shared/ai/provider'
import type { DocumentSummary } from '@shared/domain'
import { IPC_INVOKE_PREFIX, ipcContract } from '@shared/ipc/contract'
import type { IpcChannel, IpcEnvelope } from '@shared/ipc/contract'
import { LibraryError, type LibraryErrorKind } from '../library/types'
import { ServiceError, type Handlers } from '../pipelines/types'
import { INTERNAL_ERROR_MESSAGE } from './errors'
import { registerIpc, UNTRUSTED_SENDER_MESSAGE, type InvokeEventLike, type IpcMainLike } from './register'
import { memoryLog, stubHandlers } from './test-helpers'

const TRUSTED = 'file:///app/out/renderer/index.html#/library'

type Listener = (event: InvokeEventLike, ...args: unknown[]) => Promise<unknown>

function fakeIpcMain() {
  const listeners = new Map<string, Listener>()
  const ipcMain: IpcMainLike = {
    handle(channel, listener) {
      if (listeners.has(channel)) throw new Error(`second handler for ${channel}`)
      listeners.set(channel, listener)
    },
    removeHandler(channel) {
      listeners.delete(channel)
    }
  }
  const invoke = (channel: IpcChannel, input: unknown, url: string | null = TRUSTED) => {
    const listener = listeners.get(IPC_INVOKE_PREFIX + channel)
    if (!listener) throw new Error(`no handler for ${channel}`)
    return listener({ senderFrame: url === null ? null : { url } }, input) as Promise<IpcEnvelope<unknown>>
  }
  return { ipcMain, listeners, invoke }
}

const summary: DocumentSummary = {
  id: 'doc-1',
  title: 'Renamed',
  pageCount: 12,
  importedAt: '2026-10-01T00:00:00.000Z',
  lastOpenedAt: null,
  lastPage: 1,
  index: { state: 'none', indexedPages: 0, totalPages: 12 },
  cardsDue: 0,
  mastery: null,
  examDate: null
}

function setup(impl: Partial<Handlers>, isTrustedSender = (url: string) => url.startsWith('file:///app/')) {
  const { ipcMain, listeners, invoke } = fakeIpcMain()
  const log = memoryLog()
  const unregister = registerIpc(ipcMain, stubHandlers(impl), { isTrustedSender, log })
  return { listeners, invoke, log, unregister }
}

describe('registerIpc', () => {
  it('registers every contract channel under the invoke prefix and unregisters them', () => {
    const { listeners, unregister } = setup({})
    const expected = Object.keys(ipcContract).map((c) => IPC_INVOKE_PREFIX + c)
    expect([...listeners.keys()].sort()).toEqual(expected.sort())
    unregister()
    expect(listeners.size).toBe(0)
  })

  it('passes the parsed input to the handler and wraps the result', async () => {
    const rename = vi.fn((input: { docId: string; title: string }) =>
      Promise.resolve({ ...summary, title: input.title })
    )
    const { invoke } = setup({ 'library.rename': rename })
    const res = await invoke('library.rename', { docId: 'doc-1', title: 'Renamed', extra: 'dropped' })
    expect(res).toEqual({ ok: true, data: summary })
    // zod strips unknown keys: handlers only ever see contract-shaped input.
    expect(rename).toHaveBeenCalledWith({ docId: 'doc-1', title: 'Renamed' })
  })

  it('returns a readable validation error and does not call the handler', async () => {
    const rename = vi.fn()
    const { invoke, log } = setup({ 'library.rename': rename })
    const res = await invoke('library.rename', { docId: 'doc-1', title: '' })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('validation')
    expect(res.error.message).toMatch(/^Invalid input for library\.rename: title: /)
    expect(rename).not.toHaveBeenCalled()
    expect(log.lines.some((l) => l.level === 'warn')).toBe(true)
  })

  it('rejects input that is not an object at all', async () => {
    const { invoke } = setup({})
    const res = await invoke('library.list', undefined)
    expect(res).toMatchObject({ ok: false, error: { kind: 'validation' } })
  })

  it('never logs a rejected API key', async () => {
    const { invoke, log } = setup({})
    const res = await invoke('settings.setApiKey', { apiKey: 'sk-12345' })
    expect(res).toMatchObject({ ok: false, error: { kind: 'validation' } })
    expect(log.text()).not.toContain('sk-12345')
    if (!res.ok) expect(res.error.message).not.toContain('sk-12345')
  })

  it.each([
    ['a foreign origin', 'https://evil.example/'],
    ['another local file', 'file:///tmp/evil.html'],
    ['a destroyed frame', null]
  ])('rejects requests from %s', async (_label, url) => {
    const list = vi.fn()
    const { invoke, log } = setup({ 'library.list': list })
    const res = await invoke('library.list', {}, url)
    expect(res).toEqual({ ok: false, error: { kind: 'validation', message: UNTRUSTED_SENDER_MESSAGE } })
    expect(list).not.toHaveBeenCalled()
    expect(log.lines[0]?.level).toBe('warn')
  })

  it('treats a throwing trust check as untrusted', async () => {
    const { invoke } = setup({ 'library.list': () => Promise.resolve([]) }, () => {
      throw new Error('boom')
    })
    const res = await invoke('library.list', {})
    expect(res).toMatchObject({ ok: false, error: { message: UNTRUSTED_SENDER_MESSAGE } })
  })
})

describe('registerIpc error mapping', () => {
  const failWith = (err: unknown) => setup({ 'library.list': () => Promise.reject(err) })

  it('maps ServiceError to its own kind', async () => {
    const res = await failWith(new ServiceError('not_found', 'No such document')).invoke('library.list', {})
    expect(res).toEqual({
      ok: false,
      error: { kind: 'not_found', message: 'No such document', resetAt: null }
    })
  })

  it('keeps resetAt of a rate-limited ServiceError', async () => {
    const resetAt = '2026-10-17T20:00:00.000Z'
    const res = await failWith(new ServiceError('rate_limited', 'Budget reached', resetAt)).invoke(
      'library.list',
      {}
    )
    expect(res).toEqual({ ok: false, error: { kind: 'rate_limited', message: 'Budget reached', resetAt } })
  })

  it('maps a rate-limited AiError to rate_limited with resetAt', async () => {
    const resetAt = '2026-10-17T21:00:00.000Z'
    const res = await failWith(new AiError('rate_limited', 'Usage limit reached', { resetAt })).invoke(
      'library.list',
      {}
    )
    expect(res).toEqual({
      ok: false,
      error: { kind: 'rate_limited', message: 'Usage limit reached', resetAt }
    })
  })

  it.each(['auth', 'refused', 'network', 'invalid_output'] as const)(
    'maps AiError(%s) to ai',
    async (kind) => {
      const res = await failWith(new AiError(kind, `failed: ${kind}`)).invoke('library.list', {})
      expect(res).toEqual({ ok: false, error: { kind: 'ai', message: `failed: ${kind}` } })
    }
  )

  it.each<[LibraryErrorKind, RegExp]>([
    ['not_pdf', /not a PDF/],
    ['encrypted', /^Password-protected or copy-restricted PDFs are not supported yet\.$/],
    ['corrupt', /damaged/],
    ['too_large', /too large/],
    ['io', /could not be read or saved/]
  ])('maps LibraryError(%s) to a friendly validation message', async (kind, pattern) => {
    const { invoke, log } = failWith(new LibraryError(kind, `raw detail /home/user/x.pdf`))
    const res = await invoke('library.list', {})
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.error.kind).toBe('validation')
    expect(res.error.message).toMatch(pattern)
    expect(res.error.message).not.toContain('/home/user')
    expect(log.text()).toContain('raw detail')
  })

  it('maps a repository NotFoundError to not_found', async () => {
    const err = new Error('document not found: doc-9')
    err.name = 'NotFoundError'
    const res = await failWith(err).invoke('library.list', {})
    expect(res).toEqual({ ok: false, error: { kind: 'not_found', message: 'document not found: doc-9' } })
  })

  it('hides unexpected errors behind a generic message and logs the stack', async () => {
    const bug = new TypeError("Cannot read properties of undefined (reading 'id')")
    const { invoke, log } = failWith(bug)
    const res = await invoke('library.list', {})
    expect(res).toEqual({ ok: false, error: { kind: 'internal', message: INTERNAL_ERROR_MESSAGE } })
    const entry = log.lines.find((l) => l.level === 'error')
    expect(entry?.message).toContain('library.list')
    expect(entry?.err).toBe(bug)
  })

  it('treats thrown non-errors as internal', async () => {
    const res = await failWith('a string').invoke('library.list', {})
    expect(res).toMatchObject({ ok: false, error: { kind: 'internal' } })
  })
})
