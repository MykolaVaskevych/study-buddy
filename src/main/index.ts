import { join } from 'node:path'
import { app, BrowserWindow, protocol } from 'electron'
import {
  createConsoleLog,
  createMainWindow,
  ensureSingleInstance,
  registerPdfScheme,
  resolveRendererSource,
  waitForRendererLoad
} from './app'

/**
 * Composition root. Wave 2 adds the services (db, library, queue, AI registry, pipelines) and
 * registerIpc / registerPdfProtocol here.
 * `--smoke` runs the app with a hidden window and exits 0 once the renderer loaded (CI and local checks).
 */

const isSmoke = process.argv.includes('--smoke')
const log = createConsoleLog('[main]')

// Must run before app 'ready'.
registerPdfScheme(protocol)

const renderer = resolveRendererSource(
  process.env['ELECTRON_RENDERER_URL'],
  join(__dirname, '../renderer/index.html')
)

let mainWindow: BrowserWindow | null = null

function openMainWindow(): BrowserWindow {
  const win = createMainWindow({
    isSmoke,
    isDev: !app.isPackaged,
    preloadPath: join(__dirname, '../preload/index.cjs'),
    renderer
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
  return win
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  const win = openMainWindow()
  if (isSmoke) {
    try {
      await waitForRendererLoad(win.webContents, 30_000)
      console.info('[smoke] OK: renderer loaded')
      app.exit(0)
    } catch (err) {
      log.error('[smoke] FAIL', err)
      app.exit(1)
    }
    return
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openMainWindow()
  })
}

// Smoke runs skip the lock so they work while a dev instance is open.
if (!isSmoke && !ensureSingleInstance(app, () => mainWindow)) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  void bootstrap()
}
