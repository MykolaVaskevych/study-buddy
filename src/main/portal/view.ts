import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { app, session as electronSession, shell, WebContentsView } from 'electron'
import type { BaseWindow, WebContents } from 'electron'
import type { Log } from '../app/log'
import type { PortalFile, PortalNav, PortalView } from '../pipelines/types'
import { browserUserAgent, downloadTarget, isWebUrl, safeFileName } from './policy'
import type { PageSnapshot } from './snapshot'
import { clickScript, pageSnapshotSchema, SNAPSHOT_SCRIPT } from './snapshot'

/** Our scripts run in their own JavaScript world: the page can see the DOM changes, not our code. */
const AGENT_WORLD = 1077

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
  const downloadListeners: ((file: PortalFile) => void)[] = []
  let view: WebContentsView | null = null
  let host: BaseWindow | null = null
  let seq = 0
  let lastActivity = Date.now()
  const readers = new Set<WebContents>()

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
    lastActivity = Date.now()
    const state = nav(view?.webContents)
    for (const fn of changeListeners) fn(state)
  }

  ses.on('will-download', (event, item, source) => {
    if (readers.has(source)) {
      event.preventDefault()
      return
    }
    const fileName = safeFileName(item.getFilename())
    if (downloadTarget(fileName) === 'save') {
      // No dialog: like a browser, other files go to Downloads, and the portal screen says so.
      const path = join(app.getPath('downloads'), fileName)
      item.setSavePath(path)
      item.once('done', (_e, state) => {
        if (state === 'completed')
          for (const fn of downloadListeners) fn({ kind: 'saved', path, fileName, url: item.getURL() })
      })
      return
    }
    const dir = join(opts.downloadsDir, `${Date.now()}-${++seq}`)
    mkdirSync(dir, { recursive: true })
    const path = join(dir, fileName)
    item.setSavePath(path)
    item.once('done', (_e, state) => {
      if (state === 'completed') {
        for (const fn of downloadListeners) fn({ kind: 'import', path, fileName, url: item.getURL() })
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
    onDownload: (fn) => void downloadListeners.push(fn),
    async readPage(url) {
      if (!isWebUrl(url)) return null
      const hidden = new WebContentsView({
        webPreferences: {
          session: ses,
          sandbox: true,
          contextIsolation: true,
          nodeIntegration: false,
          webviewTag: false,
          spellcheck: false,
          backgroundThrottling: false
        }
      })
      // Snapshot visibility checks need a viewport even though this view is never attached.
      hidden.setBounds({ x: 0, y: 0, width: 1200, height: 900 })
      const wc = hidden.webContents
      readers.add(wc)
      wc.setWindowOpenHandler(() => ({ action: 'deny' }))
      const guard = (event: { url: string; preventDefault: () => void }): void => {
        if (!isWebUrl(event.url)) event.preventDefault()
      }
      wc.on('will-navigate', guard)
      wc.on('will-redirect', guard)
      wc.on('will-attach-webview', (event) => event.preventDefault())
      let activity = Date.now()
      let failed = false
      const active = (): void => {
        activity = Date.now()
      }
      wc.on('did-start-loading', active)
      wc.on('did-stop-loading', active)
      wc.on('did-navigate-in-page', active)
      wc.on('did-fail-load', (_event, code, _description, _url, mainFrame) => {
        if (mainFrame && code !== -3) failed = true
      })
      wc.on('did-navigate', (_event, _url, status) => {
        if (status >= 400) failed = true
      })
      let timeout: ReturnType<typeof setTimeout> | undefined
      const deadline = Date.now() + 30_000
      try {
        const read = async (): Promise<PageSnapshot | null> => {
          await wc.loadURL(url)
          while (!wc.isDestroyed() && Date.now() < deadline) {
            if (!wc.isLoading() && Date.now() - activity >= 800) break
            await new Promise((resolve) => setTimeout(resolve, 100))
          }
          if (wc.isDestroyed() || failed || Date.now() >= deadline) return null
          const raw: unknown = await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [
            {
              code: `document.querySelector('input[type="password"]') ? null : ${SNAPSHOT_SCRIPT}`
            }
          ])
          const parsed = pageSnapshotSchema.safeParse(raw)
          return parsed.success ? parsed.data : null
        }
        return await Promise.race([
          read(),
          new Promise<null>((resolve) => {
            timeout = setTimeout(() => resolve(null), 30_000)
          })
        ])
      } catch {
        return null
      } finally {
        clearTimeout(timeout)
        if (!wc.isDestroyed()) wc.close()
        readers.delete(wc)
      }
    },
    async snapshot() {
      const wc = view?.webContents
      if (!wc || wc.isDestroyed() || !isWebUrl(wc.getURL())) return null
      const raw: unknown = await wc.executeJavaScriptInIsolatedWorld(AGENT_WORLD, [{ code: SNAPSHOT_SCRIPT }])
      // Built inside a web page: checked like any untrusted input.
      const parsed = pageSnapshotSchema.safeParse(raw)
      if (!parsed.success) throw new Error('The page could not be read')
      return parsed.data
    },
    async click(id) {
      const wc = view?.webContents
      if (!wc || wc.isDestroyed()) return false
      const pressed: unknown = await wc.executeJavaScriptInIsolatedWorld(
        AGENT_WORLD,
        [{ code: clickScript(id) }],
        true
      )
      lastActivity = Date.now()
      return pressed === true
    },
    async settle(maxMs = 10_000) {
      const until = Date.now() + maxMs
      // Quiet = not loading and no navigation for a moment (pages that load content after "load").
      while (Date.now() < until) {
        const wc = view?.webContents
        if (!wc || wc.isDestroyed()) return
        if (!wc.isLoading() && Date.now() - lastActivity > 800) return
        await new Promise((resolve) => setTimeout(resolve, 100))
      }
    }
  }
}
