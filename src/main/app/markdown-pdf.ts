import { BrowserWindow } from 'electron'
import type { RendererSource } from './url-policy'

/** Long notes with many formulas still lay out well within this. */
const RENDER_TIMEOUT_MS = 60_000

/**
 * Markdown → PDF with the app's own renderer: a hidden window opens the renderer's print page
 * (#/print), renders the notes with the same Markdown and KaTeX as the app, and prints to A4.
 * Electron glue; the library decides when to call it. Raw HTML in the notes is not rendered.
 */
export function createMarkdownPdfRenderer(opts: {
  renderer: RendererSource
  preloadPath: string
}): (markdown: string, title: string) => Promise<Uint8Array> {
  return async (markdown, title) => {
    const win = new BrowserWindow({
      show: false,
      width: 900,
      height: 1200,
      webPreferences: {
        preload: opts.preloadPath,
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webviewTag: false,
        spellcheck: false
      }
    })
    // Notes may link anywhere; nothing in the print window navigates or opens windows.
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    win.webContents.on('will-navigate', (event) => event.preventDefault())
    const timer = setTimeout(() => win.destroy(), RENDER_TIMEOUT_MS)
    try {
      if (opts.renderer.kind === 'url') await win.loadURL(`${opts.renderer.url}#/print`)
      else await win.loadFile(opts.renderer.path, { hash: '/print' })
      // The print page installs window.sbPrint once mounted.
      await win.webContents.executeJavaScript(
        `new Promise((ok, fail) => { const t = Date.now(); (function wait() { if (window.sbPrint) ok(); else if (Date.now() - t > 20000) fail(new Error('print page did not load')); else setTimeout(wait, 50) })() })`
      )
      await win.webContents.executeJavaScript(
        `window.sbPrint(${JSON.stringify(markdown)}, ${JSON.stringify(title)})`
      )
      const pdf = await win.webContents.printToPDF({
        pageSize: 'A4',
        printBackground: false,
        margins: { top: 0.6, bottom: 0.6, left: 0.6, right: 0.6 }
      })
      return new Uint8Array(pdf)
    } finally {
      clearTimeout(timer)
      if (!win.isDestroyed()) win.destroy()
    }
  }
}
