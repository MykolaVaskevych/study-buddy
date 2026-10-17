import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { mkdir, open, rename, rm, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { asLibraryError, io } from './errors'
import { storedPdfPath, tempPathFor } from './paths'
import { LibraryError } from './types'

/**
 * Brings a user's PDF into the library: validate, hash, copy to `<root>/<sha>.pdf`. Files are streamed,
 * never read whole, so a large PDF costs no memory on the main thread.
 */

/** Readers accept the header anywhere in the first KiB (some generators prepend junk), so do we. */
export const PDF_HEADER_WINDOW = 1024

const PDF_HEADER = Buffer.from('%PDF-', 'latin1')

export function hasPdfHeader(head: Uint8Array): boolean {
  return Buffer.from(head.buffer, head.byteOffset, head.byteLength).includes(PDF_HEADER)
}

async function readHead(path: string, length: number): Promise<Uint8Array> {
  const file = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await file.read(buffer, 0, length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await file.close()
  }
}

/** Streams a file through sha256. */
export async function hashFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

/** Copies `source` to `dest` and returns the sha256 of exactly the bytes that were written. */
async function copyHashing(source: string, dest: string): Promise<string> {
  const hash = createHash('sha256')
  const tee = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      hash.update(chunk)
      done(null, chunk)
    }
  })
  await pipeline(createReadStream(source), tee, createWriteStream(dest, { flags: 'wx' }))
  return hash.digest('hex')
}

async function isFileOfSize(path: string, size: number): Promise<boolean> {
  return stat(path).then(
    (s) => s.isFile() && s.size === size,
    () => false
  )
}

export interface StoredSource {
  sha256: string
  storedPath: string
}

/**
 * Validates the source (size limit, %PDF- header) and stores it under its sha256.
 * Re-importing the same bytes only hashes: an existing copy of the right size is reused.
 * For a new file the copy is hashed again while writing and that hash names the file, so the stored
 * bytes always match their name even if the source changed between the two reads.
 */
export async function storeSourcePdf(
  sourcePath: string,
  rootDir: string,
  maxBytes: number
): Promise<StoredSource> {
  const name = basename(sourcePath)
  const info = await io(`Cannot read ${name}`, () => stat(sourcePath))
  if (!info.isFile()) throw new LibraryError('io', `${name} is not a file`)
  if (info.size > maxBytes) {
    throw new LibraryError('too_large', `${name} is ${toMb(info.size)} MB; the limit is ${toMb(maxBytes)} MB`)
  }
  const head = await io(`Cannot read ${name}`, () => readHead(sourcePath, PDF_HEADER_WINDOW))
  if (!hasPdfHeader(head)) throw new LibraryError('not_pdf', `${name} is not a PDF file`)

  await io('Cannot create the library directory', () => mkdir(rootDir, { recursive: true }))
  const sha256 = await io(`Cannot read ${name}`, () => hashFile(sourcePath))
  const existing = storedPdfPath(rootDir, sha256)
  if (await isFileOfSize(existing, info.size)) return { sha256, storedPath: existing }

  const tmp = tempPathFor(existing)
  try {
    const copiedSha = await copyHashing(sourcePath, tmp)
    const storedPath = storedPdfPath(rootDir, copiedSha)
    await rename(tmp, storedPath)
    return { sha256: copiedSha, storedPath }
  } catch (err) {
    await rm(tmp, { force: true })
    throw asLibraryError(err, 'io', `Cannot copy ${name} into the library`)
  }
}

function toMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1)
}
