import { EventEmitter } from 'node:events'
import { WebContentsView } from 'electron'
import { createPortalView, PORTAL_PARTITION } from './view'
import { SNAPSHOT_SCRIPT } from './snapshot'

const mocks = vi.hoisted(() => ({
  fromPartition: vi.fn(),
  load: vi.fn<() => Promise<void>>(),
  execute: vi.fn<() => Promise<unknown>>()
}))

class Contents extends EventEmitter {
  destroyed = false
  loadURL = mocks.load
  executeJavaScriptInIsolatedWorld = mocks.execute
  setWindowOpenHandler = vi.fn()
  isLoading = () => false
  isDestroyed = () => this.destroyed
  close = vi.fn(() => {
    this.destroyed = true
  })
}

vi.mock('electron', () => ({
  app: {},
  shell: {},
  session: { fromPartition: mocks.fromPartition },
  WebContentsView: vi.fn()
}))
vi.mock('node:fs', () => ({ mkdirSync: vi.fn(), rmSync: vi.fn() }))

const snapshot = { url: 'https://portal.edu/course', title: 'Course', headings: [], text: '', elements: [] }

function setup() {
  const contents = new Contents()
  const ses = Object.assign(new EventEmitter(), {
    getUserAgent: () => 'Electron/44 Chrome/130',
    setUserAgent: vi.fn(),
    setPermissionRequestHandler: vi.fn(),
    setPermissionCheckHandler: vi.fn()
  })
  mocks.fromPartition.mockReturnValue(ses)
  vi.mocked(WebContentsView).mockImplementation(function () {
    return { webContents: contents, setBounds: vi.fn() } as unknown as WebContentsView
  })
  mocks.load.mockResolvedValue(undefined)
  mocks.execute.mockResolvedValue(snapshot)
  const portal = createPortalView({
    window: () => null,
    downloadsDir: '/tmp/portal-view-test',
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  })
  return { portal, contents, ses }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
})
afterEach(() => vi.useRealTimers())

describe('PortalView.readPage', () => {
  it('uses an unattached sandboxed view on the portal session and closes it after reading', async () => {
    const { portal, contents, ses } = setup()
    const reading = portal.readPage(snapshot.url)
    expect(mocks.fromPartition).toHaveBeenCalledWith(PORTAL_PARTITION)
    expect(WebContentsView).toHaveBeenCalledWith({
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
    await vi.advanceTimersByTimeAsync(1000)
    expect(await reading).toEqual(snapshot)
    expect(mocks.execute).toHaveBeenCalledWith(1077, [{ code: expect.stringContaining(SNAPSHOT_SCRIPT) }])
    expect(contents.close).toHaveBeenCalledOnce()
    expect(portal.state().url).toBeNull()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('denies popups, non-web navigation and downloads from a watcher', async () => {
    const { portal, contents, ses } = setup()
    const downloaded = vi.fn()
    portal.onDownload(downloaded)
    const reading = portal.readPage(snapshot.url)
    const popup = contents.setWindowOpenHandler.mock.calls[0]?.[0] as () => { action: string }
    expect(popup()).toEqual({ action: 'deny' })
    const event = { url: 'file:///etc/passwd', preventDefault: vi.fn() }
    contents.emit('will-redirect', event)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    const download = { preventDefault: vi.fn() }
    ses.emit('will-download', download, {}, contents)
    expect(download.preventDefault).toHaveBeenCalledOnce()
    expect(downloaded).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1000)
    await reading
  })

  it('bounds hung loads and hung scripts and always closes the view', async () => {
    for (const stage of ['load', 'script']) {
      const { portal, contents } = setup()
      if (stage === 'load') mocks.load.mockImplementation(() => new Promise(() => undefined))
      else mocks.execute.mockImplementation(() => new Promise(() => undefined))
      const reading = portal.readPage(snapshot.url)
      await vi.advanceTimersByTimeAsync(30_000)
      expect(await reading).toBeNull()
      expect(contents.close).toHaveBeenCalledOnce()
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it('skips network failures, HTTP errors, invalid snapshots and non-web addresses', async () => {
    const { portal, contents } = setup()
    await expect(portal.readPage('file:///etc/passwd')).resolves.toBeNull()
    expect(WebContentsView).not.toHaveBeenCalled()
    mocks.load.mockRejectedValueOnce(new Error('network'))
    await expect(portal.readPage(snapshot.url)).resolves.toBeNull()
    expect(contents.close).toHaveBeenCalledOnce()
    for (const failure of ['http', 'snapshot']) {
      const next = setup()
      if (failure === 'snapshot') mocks.execute.mockResolvedValue({ invalid: true })
      const reading = next.portal.readPage(snapshot.url)
      if (failure === 'http') next.contents.emit('did-navigate', {}, snapshot.url, 403)
      await vi.advanceTimersByTimeAsync(1000)
      expect(await reading).toBeNull()
      expect(next.contents.close).toHaveBeenCalledOnce()
    }
  })
})
