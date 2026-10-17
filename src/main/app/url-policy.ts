import { dirname, isAbsolute, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * URL decisions for the window and the IPC layer, kept pure so they are unit-tested. "App URL" means
 * our own renderer: the electron-vite dev server origin, or a file inside the built renderer folder.
 */

/** Where the renderer is loaded from. */
export type RendererSource = { kind: 'url'; url: string } | { kind: 'file'; path: string }

/** electron-vite sets ELECTRON_RENDERER_URL in dev; otherwise load the built index.html. */
export function resolveRendererSource(devUrl: string | undefined, builtIndexHtml: string): RendererSource {
  return devUrl ? { kind: 'url', url: devUrl } : { kind: 'file', path: builtIndexHtml }
}

function parse(url: string): URL | null {
  try {
    return new URL(url)
  } catch {
    return null
  }
}

/** True for pages of our renderer. Used to trust IPC senders and to allow navigation. */
export function isAppUrl(source: RendererSource, url: string): boolean {
  const target = parse(url)
  if (!target) return false

  if (source.kind === 'url') {
    const dev = parse(source.url)
    // Opaque origins serialize as 'null' and would all compare equal.
    return dev !== null && dev.origin !== 'null' && target.origin === dev.origin
  }

  if (target.protocol !== 'file:') return false
  target.hash = ''
  target.search = ''
  let path: string
  try {
    // Throws for file://host/... on POSIX, which is never ours.
    path = fileURLToPath(target)
  } catch {
    return false
  }
  // The hash router keeps the path on index.html, but any file of the built renderer is ours.
  const rel = relative(dirname(source.path), path)
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/** Links we hand to the OS browser. Everything else (file:, javascript:, custom schemes) is denied. */
export function isExternalWebUrl(url: string): boolean {
  const target = parse(url)
  return target !== null && (target.protocol === 'https:' || target.protocol === 'http:')
}

export type NavigationDecision = 'allow' | 'open-external' | 'deny'

/** In-window navigation: stay inside the app, send web links to the browser, block the rest. */
export function decideNavigation(source: RendererSource, url: string): NavigationDecision {
  if (isAppUrl(source, url)) return 'allow'
  return isExternalWebUrl(url) ? 'open-external' : 'deny'
}
