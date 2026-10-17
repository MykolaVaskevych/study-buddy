import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type { PreloadApi } from '@shared/ipc/contract'
import { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX } from '@shared/ipc/contract'

/**
 * Generic, contract-driven bridge. The renderer never sees ipcRenderer itself; it gets
 * invoke(channel, input) -> envelope and on(event, listener) -> unsubscribe.
 */
const api: PreloadApi = {
  invoke: (channel, input) => ipcRenderer.invoke(IPC_INVOKE_PREFIX + channel, input),
  on: (event, listener) => {
    const wrapped = (_e: IpcRendererEvent, payload: unknown): void => listener(payload as never)
    ipcRenderer.on(IPC_EVENT_PREFIX + event, wrapped)
    return () => {
      ipcRenderer.removeListener(IPC_EVENT_PREFIX + event, wrapped)
    }
  },
  // Drag-and-drop imports: the sandbox hides File.path, webUtils is the supported replacement.
  // Returns '' for files not backed by disk; the renderer treats that as "no path".
  pathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('api', api)
