import type { z } from 'zod'
import type { IpcChannel, IpcEnvelope, IpcOutput, IpcParsedInput } from '@shared/ipc/contract'
import { IPC_INVOKE_PREFIX, ipcContract } from '@shared/ipc/contract'
import type { Log } from '../app/log'
import type { Handlers } from '../pipelines/types'
import { formatValidationIssues, toIpcFailure } from './errors'

/**
 * Registers one `ipcMain.handle` per contract channel. Every request is checked in this order:
 * trusted sender -> zod input -> handler -> envelope. Handlers never see raw renderer input.
 */

/** The part of IpcMainInvokeEvent we rely on; `senderFrame` is null once the frame is gone. */
export interface InvokeEventLike {
  readonly senderFrame: { readonly url: string } | null
}

/** The part of Electron's ipcMain we use (injected so tests run without Electron). */
export interface IpcMainLike {
  handle(channel: string, listener: (event: InvokeEventLike, ...args: unknown[]) => Promise<unknown>): void
  removeHandler(channel: string): void
}

export interface RegisterIpcOptions {
  /** True only for our own renderer (dev server origin or the bundled index.html). */
  isTrustedSender(frameUrl: string): boolean
  log: Log
}

export const UNTRUSTED_SENDER_MESSAGE = 'Request rejected: it did not come from the Study Buddy window.'

const CHANNELS = Object.keys(ipcContract) as IpcChannel[]

/**
 * Registers all handlers on `ipcMain` under `IPC_INVOKE_PREFIX + channel`.
 * Returns a function that removes them again (tests, window teardown).
 */
export function registerIpc(ipcMain: IpcMainLike, handlers: Handlers, opts: RegisterIpcOptions): () => void {
  const names: string[] = []
  for (const channel of CHANNELS) {
    const name = IPC_INVOKE_PREFIX + channel
    ipcMain.handle(name, createListener(channel, handlers, opts))
    names.push(name)
  }
  return () => {
    for (const name of names.splice(0)) ipcMain.removeHandler(name)
  }
}

/**
 * The contract seen through a mapped type. Assigning the concrete object checks every channel once,
 * and indexing the mapped type with a generic channel then yields that channel's parsed input type,
 * which indexing `ipcContract` directly cannot (it widens to the union of all schemas).
 */
const INPUTS: { readonly [C in IpcChannel]: { readonly input: z.ZodType<IpcParsedInput<C>> } } = ipcContract

function inputSchema<C extends IpcChannel>(channel: C): z.ZodType<IpcParsedInput<C>> {
  return INPUTS[channel].input
}

function createListener<C extends IpcChannel>(
  channel: C,
  handlers: Handlers,
  opts: RegisterIpcOptions
): (event: InvokeEventLike, raw?: unknown) => Promise<IpcEnvelope<IpcOutput<C>>> {
  const schema = inputSchema(channel)
  const handler = handlers[channel]
  const { log } = opts

  return async (event, raw) => {
    const frameUrl = event.senderFrame?.url ?? null
    if (frameUrl === null || !isTrusted(opts, frameUrl)) {
      log.warn(`Rejected ${channel} from untrusted sender ${frameUrl ?? '(no frame)'}`)
      return { ok: false, error: { kind: 'validation', message: UNTRUSTED_SENDER_MESSAGE } }
    }

    const parsed = schema.safeParse(raw)
    if (!parsed.success) {
      // Issues name paths and constraints, never input values, so secrets (setApiKey) stay out of logs.
      const message = `Invalid input for ${channel}: ${formatValidationIssues(parsed.error.issues)}`
      log.warn(message)
      return { ok: false, error: { kind: 'validation', message } }
    }

    try {
      return { ok: true, data: await handler(parsed.data) }
    } catch (err) {
      return toIpcFailure(err, { channel, log })
    }
  }
}

function isTrusted(opts: RegisterIpcOptions, frameUrl: string): boolean {
  try {
    return opts.isTrustedSender(frameUrl)
  } catch {
    return false
  }
}
