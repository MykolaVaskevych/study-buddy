import { join } from 'node:path'
import { app, BrowserWindow, protocol, shell } from 'electron'
import { PDF_SCHEME } from '@shared/ipc/contract'

/**
 * Composition root. Wave 2 replaces the body of `bootstrap()` with createServices() + registerIpc().
 * `--smoke` runs the app headlessly-ish and exits 0 once the renderer loaded (CI and local checks).
 */

const isSmoke = process.argv.includes('--smoke')

// Must run before app 'ready'.
protocol.registerSchemesAsPrivileged([
  { scheme: PDF_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
])

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Study Buddy',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (!isSmoke) win.show()
  })

  // Open external links in the browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) void win.loadURL(devUrl)
  else void win.loadFile(join(__dirname, '../renderer/index.html'))
  return win
}

function runSmoke(win: BrowserWindow): void {
  const fail = (reason: string): void => {
    console.error(`[smoke] FAIL: ${reason}`)
    app.exit(1)
  }
  const timer = setTimeout(() => fail('timeout waiting for renderer'), 30_000)
  win.webContents.once('did-fail-load', (_e, code, desc) => fail(`renderer failed to load: ${code} ${desc}`))
  win.webContents.once('did-finish-load', () => {
    clearTimeout(timer)
    console.info('[smoke] OK: renderer loaded')
    app.exit(0)
  })
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  const win = createWindow()
  if (isSmoke) runSmoke(win)
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

void bootstrap()
