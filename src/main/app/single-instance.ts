/** The parts of Electron's `app` and `BrowserWindow` the lock needs (injected for tests). */
export interface SingleInstanceApp {
  requestSingleInstanceLock(): boolean
  on(event: 'second-instance', listener: () => void): unknown
}

export interface FocusableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

/**
 * Takes the single-instance lock. Two instances would share one SQLite file and job queue, so a second
 * launch only brings the existing window to the front. Returns false when another instance owns the
 * lock; the caller must then quit without creating a window.
 */
export function ensureSingleInstance(
  app: SingleInstanceApp,
  getWindow: () => FocusableWindow | null
): boolean {
  if (!app.requestSingleInstanceLock()) return false
  app.on('second-instance', () => {
    const win = getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
  return true
}
