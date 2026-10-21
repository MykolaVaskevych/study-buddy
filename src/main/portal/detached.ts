import type { PortalNav, PortalView } from '../pipelines/types'

/**
 * A portal without a window, for tests, `--smoke` and scripts: navigation only records the address
 * and `download` simulates a finished download.
 */
export interface DetachedPortal extends PortalView {
  visible(): boolean
  download(file: { path: string; fileName: string; url: string }): void
}

export function createDetachedPortal(): DetachedPortal {
  let nav: PortalNav = { url: null, title: '', loading: false, canGoBack: false, canGoForward: false }
  let shown = false
  const changed: ((nav: PortalNav) => void)[] = []
  const downloads: ((file: { path: string; fileName: string; url: string }) => void)[] = []
  const history: string[] = []
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
    download: (file) => downloads.forEach((fn) => fn(file))
  }
}
