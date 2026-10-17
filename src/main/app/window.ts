import { app, BrowserWindow, Menu, shell } from 'electron'
import { buildMenuTemplate } from './menu'
import { decideNavigation, isExternalWebUrl, type RendererSource } from './url-policy'

/**
 * Main window factory. Thin Electron glue: every decision (menu items, which URLs are ours, which
 * links open externally) lives in pure, tested modules (./menu, ./url-policy).
 */

export interface MainWindowOptions {
  /** Smoke runs keep the window hidden. */
  isSmoke: boolean
  /** Adds reload and devtools to the menu. */
  isDev: boolean
  preloadPath: string
  renderer: RendererSource
  /** Window/taskbar icon (dev; packaged builds get theirs from the desktop entry). */
  icon?: string
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const { isSmoke, isDev, preloadPath, renderer, icon } = opts
  // Global, but cheap and idempotent: every window creation (macOS re-activate) gets the same menu.
  Menu.setApplicationMenu(
    Menu.buildFromTemplate(
      buildMenuTemplate({ isDev, isMac: process.platform === 'darwin', appName: app.name })
    )
  )

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'Study Buddy',
    ...(icon ? { icon } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: false,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    if (!isSmoke) win.show()
  })

  // New windows are never created: web links go to the OS browser, anything else is dropped.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalWebUrl(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  // A plain <a href> click (e.g. a link in generated notes) must not replace the app.
  win.webContents.on('will-navigate', (event) => {
    const decision = decideNavigation(renderer, event.url)
    if (decision === 'allow') return
    event.preventDefault()
    if (decision === 'open-external') void shell.openExternal(event.url)
  })
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())

  if (renderer.kind === 'url') void win.loadURL(renderer.url)
  else void win.loadFile(renderer.path)
  return win
}
