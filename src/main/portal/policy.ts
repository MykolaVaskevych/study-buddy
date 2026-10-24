import { isImportable } from '@shared/files'

/**
 * Pure rules for the in-app study-portal browser: what an address bar entry means, which downloads
 * become course files, and how the browser introduces itself to sites.
 */

/** "sulis.ul.ie" → "https://sulis.ul.ie/". Only http and https; anything else is null. */
export function normaliseAddress(input: string): string | null {
  const text = input.trim()
  if (text === '' || /\s/.test(text)) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`
  try {
    const url = new URL(withScheme)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    // A bare word ("blackboard") is not an address.
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null
    return url.href
  } catch {
    return null
  }
}

/** Pages the portal browser may show: the web, nothing local or app-internal. */
export function isWebUrl(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

/** Downloads Study Buddy can study are imported; anything else (zip, video) goes to Downloads. */
export const downloadTarget = (fileName: string): 'import' | 'save' =>
  isImportable(fileName) ? 'import' : 'save'

/**
 * Electron's default user agent names Electron and the app, which some sign-in pages (Microsoft,
 * Google) reject as an embedded browser. The portal introduces itself as the Chrome it is.
 */
export function browserUserAgent(electronUa: string): string {
  return electronUa
    .replace(/\s+Electron\/\S+/i, '')
    .replace(/\s+study-buddy\/\S+/i, '')
    .replace(/\s+Study Buddy\/\S+/i, '')
}

/** A file name that is safe in a folder, keeping its extension. */
export function safeFileName(name: string): string {
  const cleaned = [...name]
    .map((ch) => (ch.charCodeAt(0) < 32 || '\\/:*?"<>|'.includes(ch) ? '_' : ch))
    .join('')
    .trim()
  return cleaned === '' || cleaned === '.' || cleaned === '..' ? 'download' : cleaned.slice(-180)
}

/**
 * Whether a failed navigation to `url` was really a download: the download's address is the page's
 * or one it redirected to on the same site (portals often redirect a file link to a signed URL).
 */
export function becameDownload(url: string, downloadUrl: string | null): boolean {
  if (downloadUrl === null) return false
  if (downloadUrl === url) return true
  try {
    return new URL(downloadUrl).hostname === new URL(url).hostname
  } catch {
    return false
  }
}
