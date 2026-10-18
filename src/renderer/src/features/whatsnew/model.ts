import { create } from 'zustand'

export interface WhatsNewEntry {
  hash: string
  date: string
  version: string | null
  kind: 'feat' | 'fix'
  title: string
  detail: string | null
}

const KEY = 'sb.whatsnew.lastSeen'

export function readLastSeen(): string | null {
  try {
    return localStorage.getItem(KEY)
  } catch {
    return null
  }
}

export function writeLastSeen(hash: string): void {
  try {
    localStorage.setItem(KEY, hash)
  } catch {
    // Blocked storage: the dialog may show again next launch, which is harmless.
  }
}

/**
 * Entries to show after an update. `entries` are newest first. A brand-new user sees nothing (the
 * tours introduce everything); someone who has used the app before, with no record yet, sees what
 * is not released yet; afterwards, everything newer than the last entry they saw.
 */
export function pendingEntries(
  entries: readonly WhatsNewEntry[],
  lastSeen: string | null,
  existingUser: boolean
): WhatsNewEntry[] {
  if (entries.length === 0) return []
  if (lastSeen === null) return existingUser ? entries.filter((e) => e.version === null) : []
  const i = entries.findIndex((e) => e.hash === lastSeen)
  return i === -1 ? [] : entries.slice(0, i)
}

/** Groups by release, newest first; unreleased work comes first as "New since the last release". */
export function groupByVersion(
  entries: readonly WhatsNewEntry[]
): { version: string | null; items: WhatsNewEntry[] }[] {
  const groups: { version: string | null; items: WhatsNewEntry[] }[] = []
  for (const e of entries) {
    const last = groups.at(-1)
    if (last && last.version === e.version) last.items.push(e)
    else groups.push({ version: e.version, items: [e] })
  }
  return groups
}

/** Which list the dialog shows: what is new for this student, or the full history (Settings). */
export const useWhatsNewDialog = create<{
  open: 'pending' | 'all' | null
  show: (what: 'pending' | 'all') => void
  close: () => void
}>((set) => ({ open: null, show: (what) => set({ open: what }), close: () => set({ open: null }) }))
