import { describe, expect, it, vi } from 'vitest'
import { IPC_EVENT_PREFIX } from '@shared/ipc/contract'
import { createEmitter, type EventWindow } from './events'
import { memoryLog } from './test-helpers'

function fakeWindow(opts: { destroyed?: boolean; contentsDestroyed?: boolean; send?: () => void } = {}) {
  const send = vi.fn(opts.send ?? (() => undefined))
  const win: EventWindow = {
    isDestroyed: () => opts.destroyed ?? false,
    webContents: { isDestroyed: () => opts.contentsDestroyed ?? false, send }
  }
  return { win, send }
}

describe('createEmitter', () => {
  it('sends the event to every live window under the event prefix', () => {
    const a = fakeWindow()
    const b = fakeWindow()
    const emit = createEmitter(() => [a.win, b.win])
    emit('library.changed', { docId: 'doc-1' })
    for (const w of [a, b])
      expect(w.send).toHaveBeenCalledWith(`${IPC_EVENT_PREFIX}library.changed`, { docId: 'doc-1' })
  })

  it('skips destroyed windows and destroyed web contents', () => {
    const gone = fakeWindow({ destroyed: true })
    const crashed = fakeWindow({ contentsDestroyed: true })
    const live = fakeWindow()
    createEmitter(() => [gone.win, crashed.win, live.win])('ai.rateLimited', null)
    expect(gone.send).not.toHaveBeenCalled()
    expect(crashed.send).not.toHaveBeenCalled()
    expect(live.send).toHaveBeenCalledWith(`${IPC_EVENT_PREFIX}ai.rateLimited`, null)
  })

  it('keeps delivering when one window throws, and logs it', () => {
    const broken = fakeWindow({
      send: () => {
        throw new Error('object could not be cloned')
      }
    })
    const live = fakeWindow()
    const log = memoryLog()
    createEmitter(() => [broken.win, live.win], log)('pageCheck.ready', { docId: 'd', page: 3 })
    expect(live.send).toHaveBeenCalledTimes(1)
    expect(log.lines[0]).toMatchObject({
      level: 'error',
      message: expect.stringContaining('pageCheck.ready')
    })
  })

  it('looks windows up on every emit', () => {
    const windows: EventWindow[] = []
    const emit = createEmitter(() => windows)
    emit('cards.changed', { docId: 'd' })
    const late = fakeWindow()
    windows.push(late.win)
    emit('cards.changed', { docId: 'd' })
    expect(late.send).toHaveBeenCalledTimes(1)
  })
})
