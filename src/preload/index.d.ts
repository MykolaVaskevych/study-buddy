import type { PreloadApi } from '@shared/ipc/contract'

declare global {
  interface Window {
    /** Present inside Electron. In plain-browser dev mode the renderer installs a mock (see api/mock.ts). */
    api: PreloadApi
  }
}

export {}
