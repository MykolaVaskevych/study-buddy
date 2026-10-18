import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'

/**
 * "What's new" from git history, so release notes never need hand-written code: user-facing
 * commits (feat/fix, Conventional Commits) become entries, grouped by release tag. A body line
 * "What's new: ..." gives a friendlier description; otherwise the first prose paragraph is used.
 * Exposed to the renderer as `virtual:whatsnew`.
 */

export interface WhatsNewEntry {
  hash: string
  date: string
  /** Release tag that first contains the commit (e.g. "v0.1.1"), or null if not released yet. */
  version: string | null
  kind: 'feat' | 'fix'
  title: string
  detail: string | null
}

/** Scopes that never matter to users. */
const INTERNAL_SCOPES = new Set([
  'release',
  'ci',
  'build',
  'test',
  'tests',
  'deps',
  'docs',
  'contracts',
  'lint',
  'app',
  'main'
])
const SUBJECT = /^(feat|fix)(?:\(([^)]+)\))?!?:\s*(.+)$/

/** Parses `git log` records (fields \x1f, records \x1e) into entries, newest first. */
export function parseLog(raw: string, tagOf: ReadonlyMap<string, string>): WhatsNewEntry[] {
  const entries: WhatsNewEntry[] = []
  let version: string | null = null
  for (const record of raw.split('\x1e')) {
    const [hash = '', date = '', subject = '', body = ''] = record.replace(/^\s+/, '').split('\x1f')
    if (!hash) continue
    // Walking newest → oldest: a tagged commit starts that release (and belongs to it).
    version = tagOf.get(hash) ?? version
    const m = SUBJECT.exec(subject.trim())
    if (!m?.[1] || !m[3]) continue
    if (m[2] && INTERNAL_SCOPES.has(m[2].toLowerCase())) continue
    const title = m[3].replace(/\s*\(#\d+\)\s*$/, '').trim()
    entries.push({
      hash,
      date,
      version,
      kind: m[1] as 'feat' | 'fix',
      title: title.charAt(0).toUpperCase() + title.slice(1),
      detail: detailOf(body)
    })
  }
  return entries
}

/** "What's new: ..." line if present, else the first prose paragraph (not a bullet list). */
export function detailOf(body: string): string | null {
  const explicit = /^what'?s new:\s*(.+)$/im.exec(body)
  if (explicit?.[1]) return explicit[1].trim()
  const first =
    body
      .trim()
      .split(/\n\s*\n/)[0]
      ?.replace(/\s+/g, ' ')
      .trim() ?? ''
  if (!first || /^[-*]|^closes #|^refs #/i.test(first) || first.length > 400) return null
  return first
}

function git(root: string, args: string[]): string {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
}

/** Reads the history; returns [] when git or the history is unavailable (e.g. a source tarball). */
export function readWhatsNew(root: string, limit = 400): WhatsNewEntry[] {
  try {
    const tagOf = new Map<string, string>()
    for (const tag of git(root, ['tag', '--list', 'v*']).split('\n').filter(Boolean)) {
      tagOf.set(git(root, ['rev-list', '-n', '1', tag]).trim(), tag)
    }
    const raw = git(root, ['log', '--no-merges', `-n${limit}`, '--format=%H%x1f%cI%x1f%s%x1f%b%x1e'])
    return parseLog(raw, tagOf)
  } catch {
    return []
  }
}

const ID = 'virtual:whatsnew'

export function whatsnew(root: string): Plugin {
  return {
    name: 'study-buddy:whatsnew',
    resolveId: (id) => (id === ID ? `\0${ID}` : null),
    load(id) {
      if (id !== `\0${ID}`) return null
      const version = (JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')) as { version: string })
        .version
      return `export const appVersion = ${JSON.stringify(version)}\nexport const entries = ${JSON.stringify(readWhatsNew(root))}\n`
    }
  }
}
