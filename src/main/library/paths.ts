import { randomBytes } from 'node:crypto'
import { rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { LibraryError } from './types'

/**
 * On-disk layout of the library, in one place:
 *
 *   <root>/<sha>.pdf                    stored copy of the imported PDF
 *   <root>/<sha>/extract.json           cached extraction (text, outline, labels, title)
 *   <root>/<sha>/chunks/<index>.pdf     stamped chunk PDFs
 *   <root>/<sha>/chunks/manifest.json   chunk grid (ranges, sizes, options it was built with)
 *   <root>/<sha>/focus/<from>-<to>.pdf  cached focus chunks (a few stamped pages, see focus.ts)
 *
 * Chunk paths are derived from the directory rather than stored, so a moved library keeps working.
 */

const SHA256_HEX = /^[0-9a-f]{64}$/

/**
 * Hashes come from the database or IPC and end up in paths that `deleteFiles` removes recursively,
 * so anything but a lowercase hex sha256 is rejected before it can reach the filesystem.
 */
export function assertSha256(sha256: string): void {
  if (!SHA256_HEX.test(sha256)) throw new LibraryError('io', `Invalid document hash: "${sha256}"`)
}

export function storedPdfPath(rootDir: string, sha256: string): string {
  return join(rootDir, `${sha256}.pdf`)
}

export function documentDir(rootDir: string, sha256: string): string {
  return join(rootDir, sha256)
}

export function extractCachePath(rootDir: string, sha256: string): string {
  return join(documentDir(rootDir, sha256), 'extract.json')
}

export function chunksDir(rootDir: string, sha256: string): string {
  return join(documentDir(rootDir, sha256), 'chunks')
}

export function focusFilePath(rootDir: string, sha256: string, from: number, to: number): string {
  return join(documentDir(rootDir, sha256), 'focus', `${from}-${to}.pdf`)
}

export function chunkFilePath(dir: string, index: number): string {
  return join(dir, `${index}.pdf`)
}

export function chunkManifestPath(dir: string): string {
  return join(dir, 'manifest.json')
}

/** A unique sibling path for writing a file before it is renamed into place. */
export function tempPathFor(path: string): string {
  return `${path}.${process.pid}-${randomBytes(4).toString('hex')}.tmp`
}

/**
 * Writes via a temp file and rename, so readers never see a half-written chunk or cache file and a crash
 * leaves either the old file or none (which the existence and size checks then repair).
 */
export async function writeFileAtomic(path: string, data: string | Uint8Array): Promise<void> {
  const tmp = tempPathFor(path)
  try {
    await writeFile(tmp, data)
    await rename(tmp, path)
  } catch (err) {
    await rm(tmp, { force: true })
    throw err
  }
}
