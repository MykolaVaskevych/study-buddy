import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { session as electronSession, shell, WebContentsView } from 'electron'
import type { BaseWindow, WebContents } from 'electron'
import type { Log } from '../app/log'
import type { PortalNav, PortalView } from '../pipelines/types'
import { browserUserAgent, downloadTarget, isWebUrl, safeFileName } from './policy'

/** Signed-in portals survive restarts in this session; nothing else in the app shares it. */
export const PORTAL_PARTITION = 'persist:portal'

const EMPTY: PortalNav = { url: null, title: '', loading: false, canGoBack: false, canGoForward: false }

/**
 * The portal browser: an Electron WebContentsView placed over the portal screen of the main window.
 * Electron glue only; the rules live in ./policy and the decisions in pipelines/portal.
 *
 * - Its own persistent session: the student signs in on the site itself (SSO, 2FA); the app never
 *   sees the password. No preload, sandboxed, every permission (camera, notifications…) denied.
 * - Only http(s) pages; mailto: opens the mail app; links that would open a window open here.
 * - Study files (PDF, PowerPoint, Word…) download into a folder of their own under `downloadsDir`
 *   and are handed to the listeners; other downloads get the usual save dialog.
 */
export function createPortalView(opts: {
  window: () => BaseWindow | null
  downloadsDir: string
  log: Log
}): PortalView {
  const { log } = opts
  // Leftovers of an earlier run (a crash between download and import) are not worth keeping.
  rmSync(opts.downloadsDir, { recursive: true, force: true })
  const ses = electronSession.fromPartition(PORTAL_PARTITION)
  ses.setUserAgent(browserUserAgent(ses.getUserAgent()))
  ses.setPermissionRequestHandler((_wc, _permission, allow) => allow(false))
  ses.setPermissionCheckHandler(() => false)

  const changeListeners: ((nav: PortalNav) => void)[] = []
  const downloadListeners: ((file: { path: string; fileName: string; url: string }) => void)[] = []
  let view: WebContentsView | null = null
  let host: BaseWindow | null = null
  let seq = 0

  const nav = (wc: WebContents | undefined): PortalNav => {
    if (!wc || wc.isDestroyed()) return EMPTY
    const url = wc.getURL()
    return {
      url: isWebUrl(url) ? url : null,
      title: wc.getTitle(),
      loading: wc.isLoading(),
      canGoBack: wc.navigationHistory.canGoBack(),
      canGoForward: wc.navigationHistory.canGoForward()
    }
  }
  const changed = (): void => {
    const state = nav(view?.webContents)
    for (const fn of changeListeners) fn(state)
  }

  ses.on('will-download', (_event, item) => {
    const fileName = safeFileName(item.getFilename())
    if (downloadTarget(fileName) === 'save') return
    const dir = join(opts.downloadsDir, `${Date.now()}-${++seq}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fileName)
    item.setSavePath(path)
    item.once('done', (_e, state) => {
      if (state === 'completed') {
        for (const fn of downloadListeners) fn({ path, fileName, url: item.getURL() })
      } else log.warn(`[portal] download of ${fileName} ${state}`)
    })
  })

  const ensure = (): WebContentsView => {
    if (view && !view.webContents.isDestroyed()) return view
    const created = new WebContentsView({
      webPreferences: {
        session: ses,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false
      }
    })
    const wc = created.webContents
    wc.setWindowOpenHandler(({ url }) => {
      if (isWebUrl(url)) void wc.loadURL(url).catch(() => undefined)
      return { action: 'deny' }
    })
    const guard = (event: { url: string; preventDefault: () => void }): void => {
      if (isWebUrl(event.url)) return
      event.preventDefault()
      if (event.url.startsWith('mailto:')) void shell.openExternal(event.url)
    }
    wc.on('will-navigate', guard)
    wc.on('will-redirect', guard)
    wc.on('will-attach-webview', (event) => event.preventDefault())
    wc.on('did-navigate', changed)
    wc.on('did-navigate-in-page', changed)
    wc.on('page-title-updated', changed)
    wc.on('did-start-loading', changed)
    wc.on('did-stop-loading', changed)
    view = created
    return created
  }

  const attach = (): WebContentsView | null => {
    const win = opts.window()
    if (!win || win.isDestroyed()) return null
    const v = ensure()
    if (host !== win) {
      if (host && !host.isDestroyed()) host.contentView.removeChildView(v)
      win.contentView.addChildView(v)
      host = win
      win.once('closed', () => {
        if (host === win) host = null
        if (view === v && !v.webContents.isDestroyed()) v.webContents.close()
        if (view === v) view = null
      })
    }
    return v
  }

  return {
    show(bounds) {
      const v = attach()
      if (!v) return
      v.setBounds(bounds)
      v.setVisible(true)
    },
    hide() {
      view?.setVisible(false)
    },
    setBounds(bounds) {
      view?.setBounds(bounds)
    },
    navigate(url) {
      // Aborted loads (a redirect replacing this one) reject; the page still arrives.
      ensure()
        .webContents.loadURL(url)
        .catch((err: unknown) =>
          log.warn(`[portal] ${url}: ${err instanceof Error ? err.message : String(err)}`)
        )
    },
    go(action) {
      const wc = view?.webContents
      if (!wc || wc.isDestroyed()) return
      if (action === 'back') wc.navigationHistory.goBack()
      else if (action === 'forward') wc.navigationHistory.goForward()
      else if (action === 'reload') wc.reload()
      else wc.stop()
    },
    state: () => nav(view?.webContents),
    async signOut() {
      await ses.clearStorageData()
      await ses.clearCache()
      const wc = view?.webContents
      if (wc && !wc.isDestroyed()) {
        wc.navigationHistory.clear()
        await wc.loadURL('about:blank').catch(() => undefined)
      }
      changed()
    },
    onChange: (fn) => void changeListeners.push(fn),
    onDownload: (fn) => void downloadListeners.push(fn)
  }
}
