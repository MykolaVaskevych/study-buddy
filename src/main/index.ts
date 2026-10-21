import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, protocol, safeStorage } from 'electron'
import { createClaudeAuth, createProvider, createStudyAi, findClaudeExecutable, listModels } from './ai'
import {
  createAiRegistry,
  createConsoleLog,
  createMainWindow,
  createSecretStore,
  ensureSingleInstance,
  OPENAI_COMPATIBLE_KEY_SECRET,
  isAppUrl,
  pickPdfs,
  registerPdfProtocol,
  registerPdfScheme,
  resolveRendererSource,
  runPortalSmoke,
  runSmoke,
  waitForRendererLoad,
  writeSmokePdf
} from './app'
import { openDatabase } from './db'
import { createEmitter, registerIpc } from './ipc'
import { createJobQueue } from './jobs'
import { createPortalView } from './portal/view'
import { createOfficeConverter, createPdfLibrary, DEFAULT_CHUNK_OPTIONS, findSoffice } from './library'
import { createPipelines } from './pipelines'
import { createSrs } from './srs'

/**
 * Composition root: builds every service, registers IPC and the PDF protocol, opens the window.
 * `--smoke` uses a throwaway data dir and the fake AI provider, runs the full user flow through the
 * real handlers and exits 0/1 (CI and local checks).
 */

const isSmoke = process.argv.includes('--smoke')
/** Runs the AI connection test (settings' provider) headlessly and exits 0/1; handy for support. */
const isCheckAi = process.argv.includes('--check-ai')
const log = createConsoleLog('[main]')

// Must run before app 'ready'.
registerPdfScheme(protocol)
if (isSmoke) app.setPath('userData', mkdtempSync(join(tmpdir(), 'study-buddy-smoke-')))

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
    renderer,
    icon: app.isPackaged ? undefined : join(app.getAppPath(), 'build/icon.png')
  })
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  mainWindow = win
  return win
}

async function bootstrap(): Promise<void> {
  await app.whenReady()
  const dataDir = app.getPath('userData')
  const now = (): Date => new Date()
  const db = openDatabase(join(dataDir, 'study-buddy.db'), { now })
  const secrets = createSecretStore(db.settings, safeStorage, { log })
  const openAiSecrets = createSecretStore(db.settings, safeStorage, {
    log,
    name: OPENAI_COMPATIBLE_KEY_SECRET
  })
  const library = createPdfLibrary(
    { rootDir: join(dataDir, 'library'), chunk: DEFAULT_CHUNK_OPTIONS },
    {
      officeConverter: createOfficeConverter({
        locate: () => findSoffice(),
        flatpak: Boolean(process.env['FLATPAK_ID']),
        profileDir: join(dataDir, 'libreoffice-profile')
      })
    }
  )
  const ai = createAiRegistry({
    getSettings: () => db.settings.get(),
    secrets,
    openAiSecrets,
    // Text-only models get chunk PDFs as page text, read by the library's PDF worker.
    createProvider: (settings, keys) =>
      createProvider(settings, keys, { pdfText: (path) => library.pageTexts(path) }),
    createStudyAi,
    forceProvider: isSmoke ? 'fake' : undefined
  })
  const pipelines = createPipelines({
    db,
    library,
    queue: createJobQueue({ repo: db.jobs, concurrency: db.settings.get().aiConcurrency, now }),
    srs: createSrs(),
    aiFor: (provider) => ai.aiFor(provider),
    secrets,
    openAiSecrets,
    connections: {
      claude: createClaudeAuth({
        executable: () => db.settings.get().claudeCodePath ?? findClaudeExecutable()
      }),
      listModels: (baseUrl, apiKey) => listModels({ baseUrl, apiKey })
    },
    emit: createEmitter(() => BrowserWindow.getAllWindows(), log),
    now,
    pickPdfs: () => pickPdfs(mainWindow),
    appInfo: { version: app.getVersion(), platform: process.platform, dataDir },
    portal: createPortalView({
      window: () => mainWindow,
      downloadsDir: join(dataDir, 'portal-downloads'),
      log
    })
  })
  registerIpc(ipcMain, pipelines.handlers, { isTrustedSender: (url) => isAppUrl(renderer, url), log })
  registerPdfProtocol(protocol, (docId) => db.documents.get(docId)?.storedPath ?? null, { log })
  pipelines.start()

  let quitting = false
  app.on('before-quit', (event) => {
    if (quitting) return
    quitting = true
    event.preventDefault()
    void pipelines
      .stop()
      .catch((err: unknown) => log.error('pipelines.stop failed', err))
      .finally(() => {
        db.close()
        app.quit()
      })
  })

  if (isCheckAi) {
    const health = await pipelines.handlers['ai.health']({ provider: null })
    log.info(
      `[check-ai] ${health.ok ? 'OK' : 'FAIL'} ${health.provider} ${health.model ?? ''} ${health.latencyMs ?? ''} ms: ${health.message}`
    )
    await pipelines.stop()
    app.exit(health.ok ? 0 : 1)
    return
  }

  const win = openMainWindow()
  if (isSmoke) {
    try {
      await waitForRendererLoad(win.webContents, 30_000)
      log.info('[smoke] OK: renderer loaded')
      // Round trip through the real preload bridge: catches a broken preload (the renderer would
      // otherwise fall back to the browser mock).
      const bridge: unknown = await win.webContents.executeJavaScript(
        "window.api ? window.api.invoke('app.info', {}).then((r) => r.ok) : false"
      )
      if (bridge !== true) throw new Error('renderer has no working window.api bridge')
      log.info('[smoke] OK: preload bridge round trip')
      const pdfPath = await writeSmokePdf(join(dataDir, 'smoke'))
      await runSmoke(pipelines.handlers, { pdfPath, log, timeoutMs: 120_000 })
      await runPortalSmoke(pipelines.handlers, { pdfPath, log, timeoutMs: 30_000 })
      await pipelines.stop()
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
if (!isSmoke && !isCheckAi && !ensureSingleInstance(app, () => mainWindow)) {
  app.quit()
} else {
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
  void bootstrap()
}
