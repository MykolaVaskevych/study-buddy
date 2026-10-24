import type { PortalFile, PortalNav, PortalView } from '../pipelines/types'
import type { PageSnapshot } from './snapshot'

/**
 * A portal without a window, for tests, `--smoke` and scripts: navigation only records the address
 * and `download` simulates a finished download.
 */
export interface DetachedPortal extends PortalView {
  visible(): boolean
  download(file: PortalFile): void
  /** Tests script the pages the AI sees and what a click does. */
  readWith(reader: (url: string) => Promise<PageSnapshot | null>): void
  script(site: { snapshot: () => PageSnapshot | null; click: (id: number) => boolean }): void
}

export function createDetachedPortal(): DetachedPortal {
  let nav: PortalNav = { url: null, title: '', loading: false, canGoBack: false, canGoForward: false }
  let reader: (url: string) => Promise<PageSnapshot | null> = async () => null
  let shown = false
  const changed: ((nav: PortalNav) => void)[] = []
  const downloads: ((file: PortalFile) => void)[] = []
  const history: string[] = []
  let site: { snapshot: () => PageSnapshot | null; click: (id: number) => boolean } = {
    snapshot: () => null,
    click: () => false
  }
  const set = (next: Partial<PortalNav>): void => {
    nav = { ...nav, ...next }
    for (const fn of changed) fn(nav)
  }
  return {
    show: () => {
      shown = true
    },
    hide: () => {
      shown = false
    },
    setBounds: () => undefined,
    navigate(url) {
      history.push(url)
      set({ url, title: url, canGoBack: history.length > 1 })
    },
    go(action) {
      if (action === 'back' && history.length > 1) {
        history.pop()
        set({ url: history.at(-1) ?? null, canGoBack: history.length > 1 })
      }
    },
    state: () => nav,
    signOut: async () => undefined,
    onChange: (fn) => void changed.push(fn),
    onDownload: (fn) => void downloads.push(fn),
    visible: () => shown,
    download: (file) => downloads.forEach((fn) => fn(file)),
    script: (next) => {
      site = next
    },
    readWith: (next) => {
      reader = next
    },
    readPage: (url) => reader(url),
    snapshot: async () => site.snapshot(),
    click: async (id) => site.click(id),
    settle: async () => undefined
  }
}
