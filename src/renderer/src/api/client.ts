import type {
  IpcChannel,
  IpcErrorKind,
  IpcEvent,
  IpcEvents,
  IpcInput,
  IpcOutput,
  PreloadApi
} from '@shared/ipc/contract'

/** Error thrown by `call` when main returns a failed envelope. */
export class ApiError extends Error {
  readonly kind: IpcErrorKind
  readonly resetAt: string | null
  constructor(kind: IpcErrorKind, message: string, resetAt: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.resetAt = resetAt
  }
}

let bridge: PreloadApi | null = null

/** Tests and browser mode install their own bridge (see ./mock.ts). */
export function setBridge(api: PreloadApi): void {
  bridge = api
}

function getBridge(): PreloadApi {
  if (bridge) return bridge
  if (typeof window !== 'undefined' && window.api) return window.api
  throw new Error('No IPC bridge: run inside Electron or install the mock api')
}

/** Shown when the window is newer than the main process (e.g. after `git pull` under `npm run dev`). */
export const OUTDATED_MESSAGE =
  'Study Buddy was updated while it was open. Close it and start it again to use this.'

export async function call<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
  const envelope = await getBridge()
    .invoke(channel, input)
    .catch((err: unknown) => {
      // Electron rejects (instead of returning an envelope) when main has no handler for the channel.
      if (err instanceof Error && err.message.includes('No handler registered'))
        throw new ApiError('internal', OUTDATED_MESSAGE)
      throw err
    })
  if (envelope.ok) return envelope.data
  throw new ApiError(envelope.error.kind, envelope.error.message, envelope.error.resetAt ?? null)
}

export function subscribe<E extends IpcEvent>(
  event: E,
  listener: (payload: IpcEvents[E]) => void
): () => void {
  return getBridge().on(event, listener)
}

/**
 * Optional bridge capability, not in PreloadApi yet: resolve a dropped File to its absolute
 * path. Electron's sandbox hides File.path, so the preload must expose
 * `pathForFile: (file) => webUtils.getPathForFile(file)` (follow-up for the lead). Returns
 * null when the bridge can't do it, and callers fall back to the native file picker.
 */
export function pathForFile(file: File): string | null {
  const api: unknown = bridge ?? (typeof window !== 'undefined' ? window.api : undefined)
  if (typeof api !== 'object' || api === null || !('pathForFile' in api)) return null
  const resolve = api.pathForFile
  if (typeof resolve !== 'function') return null
  const path: unknown = resolve.call(api, file)
  return typeof path === 'string' && path.length > 0 ? path : null
}
