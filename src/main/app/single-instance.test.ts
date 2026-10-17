import { describe, expect, it, vi } from 'vitest'
import { ensureSingleInstance, type FocusableWindow, type SingleInstanceApp } from './single-instance'

function fakeApp(locked: boolean) {
  let listener: (() => void) | null = null
  const app: SingleInstanceApp = {
    requestSingleInstanceLock: () => locked,
    on: (_event, l) => {
      listener = l
    }
  }
  return { app, secondInstance: () => listener?.() }
}

function fakeWindow(minimized: boolean): FocusableWindow {
  return {
    isDestroyed: () => false,
    isMinimized: () => minimized,
    restore: vi.fn(),
    show: vi.fn(),
    focus: vi.fn()
  }
}

describe('ensureSingleInstance', () => {
  it('returns false when another instance holds the lock', () => {
    expect(ensureSingleInstance(fakeApp(false).app, () => null)).toBe(false)
  })

  it('brings the existing window to the front on a second launch', () => {
    const { app, secondInstance } = fakeApp(true)
    const win = fakeWindow(true)
    expect(ensureSingleInstance(app, () => win)).toBe(true)
    secondInstance()
    expect(win.restore).toHaveBeenCalled()
    expect(win.show).toHaveBeenCalled()
    expect(win.focus).toHaveBeenCalled()
  })

  it('ignores a second launch while no window exists', () => {
    const { app, secondInstance } = fakeApp(true)
    ensureSingleInstance(app, () => null)
    expect(() => secondInstance()).not.toThrow()
  })
})
