import { IPC_EVENT_PREFIX } from '@shared/ipc/contract'
import type { Log } from '../app/log'
import type { EmitEvent } from '../pipelines/types'

/** The part of BrowserWindow the emitter needs (injected so tests run without Electron). */
export interface EventWindow {
  isDestroyed(): boolean
  readonly webContents: {
    isDestroyed(): boolean
    send(channel: string, ...args: unknown[]): void
  }
}

/**
 * Pushes events to every live window on `IPC_EVENT_PREFIX + event`. Windows are looked up per emit,
 * so windows opened later (macOS re-activate) receive events too. A failing window is logged and
 * skipped; it must not stop delivery to the others or crash the background job that emitted.
 */
export function createEmitter(getWindows: () => readonly EventWindow[], log?: Log): EmitEvent {
  return (event, payload) => {
    const channel = IPC_EVENT_PREFIX + event
    for (const win of getWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch (err) {
        log?.error(`Could not deliver event ${event}`, err)
      }
    }
  }
}
