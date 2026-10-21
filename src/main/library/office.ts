import { spawn as nodeSpawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename, extname, join, posix, win32 } from 'node:path'
import { pathToFileURL } from 'node:url'
import { LibraryError } from './types'

/**
 * PowerPoint, Word and OpenDocument files become PDFs through the user's LibreOffice, run headless.
 * Everything after the conversion (pages, chunks, the reader) works on the PDF as usual.
 */

/** Converts `source` to `<outDir>/<name>.pdf` and resolves with that path. */
export interface OfficeConverter {
  toPdf(source: string, outDir: string): Promise<string>
}

/** The process API this module needs from node:child_process (injected in tests). */
export interface ChildLike {
  stderr: { on(event: 'data', fn: (chunk: Buffer) => void): void } | null
  on(event: 'error', fn: (err: NodeJS.ErrnoException) => void): void
  on(event: 'close', fn: (code: number | null) => void): void
  kill(): void
}
export type SpawnFn = (command: string, args: string[]) => ChildLike

/** Within this long, even a 300-slide deck converts; a hung LibreOffice is killed. */
export const DEFAULT_CONVERT_TIMEOUT_MS = 5 * 60_000

/** How to get LibreOffice on each platform, for the "converter missing" message. */
export function installHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32')
    return 'Install LibreOffice (winget install TheDocumentFoundation.LibreOffice), then try again.'
  if (platform === 'darwin') return 'Install LibreOffice (brew install --cask libreoffice), then try again.'
  return 'Install LibreOffice (Arch: sudo pacman -S libreoffice-fresh, Ubuntu: sudo apt install libreoffice-impress libreoffice-writer), then try again.'
}

/**
 * Finds `soffice`. Inside the Flatpak it runs on the host (null here means "ask the host"); elsewhere
 * PATH first, then the standard install locations. Null when nothing is found.
 */
export function findSoffice(
  env: NodeJS.ProcessEnv = process.env,
  exists: (path: string) => boolean = existsSync,
  platform: NodeJS.Platform = process.platform
): string | null {
  // Path rules of the target platform, not the host's (tests run every platform's case everywhere).
  const path = platform === 'win32' ? win32 : posix
  const name = platform === 'win32' ? 'soffice.exe' : 'soffice'
  const fromPath = (env['PATH'] ?? '')
    .split(path.delimiter)
    .filter(Boolean)
    .map((dir) => path.join(dir, name))
  const known =
    platform === 'win32'
      ? [
          path.join(env['ProgramFiles'] ?? 'C:\\Program Files', 'LibreOffice', 'program', name),
          path.join(env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)', 'LibreOffice', 'program', name)
        ]
      : platform === 'darwin'
        ? ['/Applications/LibreOffice.app/Contents/MacOS/soffice']
        : [
            '/usr/bin/soffice',
            '/usr/lib/libreoffice/program/soffice',
            '/opt/libreoffice/program/soffice',
            '/snap/bin/libreoffice'
          ]
  return [...fromPath, ...known].find((p) => exists(p)) ?? null
}

/**
 * The command line. A private profile directory keeps a running LibreOffice from swallowing the
 * conversion (it would hand the job to the open instance and exit without writing anything).
 */
export function sofficeCommand(
  executable: string,
  source: string,
  outDir: string,
  profileDir: string,
  flatpak: boolean
): { command: string; args: string[] } {
  const args = [
    `-env:UserInstallation=${pathToFileURL(profileDir).href}`,
    '--headless',
    '--norestore',
    '--convert-to',
    'pdf',
    '--outdir',
    outDir,
    source
  ]
  // On the host through a login shell, so the user's PATH finds their LibreOffice.
  if (flatpak)
    return {
      command: 'flatpak-spawn',
      args: ['--host', '--watch-bus', 'sh', '-lc', 'exec soffice "$@"', 'soffice', ...args]
    }
  return { command: executable, args }
}

export function createOfficeConverter(opts: {
  /** soffice's path, or null when it is not installed (ignored in the Flatpak). */
  locate: () => string | null
  flatpak: boolean
  profileDir: string
  spawn?: SpawnFn
  timeoutMs?: number
  platform?: NodeJS.Platform
}): OfficeConverter {
  const spawn: SpawnFn =
    opts.spawn ?? ((command, args) => nodeSpawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] }))
  const timeoutMs = opts.timeoutMs ?? DEFAULT_CONVERT_TIMEOUT_MS
  const missing = (): LibraryError => new LibraryError('converter_missing', installHint(opts.platform))

  return {
    async toPdf(source, outDir) {
      const executable = opts.flatpak ? 'soffice' : opts.locate()
      if (executable === null) throw missing()
      const { command, args } = sofficeCommand(executable, source, outDir, opts.profileDir, opts.flatpak)
      const name = basename(source)
      await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args)
        let stderr = ''
        child.stderr?.on('data', (chunk) => {
          stderr = (stderr + chunk.toString()).slice(-2000)
        })
        const timer = setTimeout(() => {
          child.kill()
          reject(new LibraryError('conversion_failed', `LibreOffice took too long to convert ${name}`))
        }, timeoutMs)
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err.code === 'ENOENT' ? missing() : new LibraryError('conversion_failed', err.message, err))
        })
        child.on('close', (code) => {
          clearTimeout(timer)
          // 127: the host shell found no soffice (Flatpak).
          if (code === 127) reject(missing())
          else if (code !== 0) {
            const detail = stderr.trim().split('\n').at(-1) ?? ''
            reject(
              new LibraryError(
                'conversion_failed',
                `LibreOffice could not convert ${name}${detail ? `: ${detail}` : ''}`
              )
            )
          } else resolve()
        })
      })
      const pdf = join(outDir, `${basename(source, extname(source))}.pdf`)
      const made = await stat(pdf).then(
        (s) => s.isFile() && s.size > 0,
        () => false
      )
      if (!made) throw new LibraryError('conversion_failed', `LibreOffice wrote no PDF for ${name}`)
      return pdf
    }
  }
}
