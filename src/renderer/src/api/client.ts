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

export async function call<C extends IpcChannel>(channel: C, input: IpcInput<C>): Promise<IpcOutput<C>> {
  const envelope = await getBridge().invoke(channel, input)
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
