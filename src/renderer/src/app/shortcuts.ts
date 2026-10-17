import { useEffect } from 'react'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
}

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

/** Matches "Mod+1", "Shift+G", "/" style shortcuts. Mod = Ctrl (⌘ on macOS). */
export function matchShortcut(e: KeyLike, shortcut: string): boolean {
  const parts = shortcut === '+' ? ['+'] : shortcut.split(/\+(?!$)/)
  const key = parts[parts.length - 1] ?? ''
  const mods = new Set(parts.slice(0, -1))
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (mods.has('Mod') !== mod) return false
  if (mods.has('Alt') !== e.altKey) return false
  if (mods.has('Shift') && !e.shiftKey) return false
  return e.key.toLowerCase() === key.toLowerCase()
}

/** True when keystrokes belong to a text field rather than to app shortcuts. */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  const tag = target.tagName
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true
  if (tag !== 'INPUT') return false
  const type = (target as HTMLInputElement).type
  return !['checkbox', 'radio', 'button', 'submit', 'range'].includes(type)
}

/** Window-level shortcut map, ignored while typing or while a modal dialog is open. */
export function useShortcuts(map: Record<string, () => void>, enabled = true): void {
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.defaultPrevented || isEditableTarget(e.target) || document.querySelector('dialog[open]')) return
      for (const [shortcut, run] of Object.entries(map)) {
        if (matchShortcut(e, shortcut)) {
          e.preventDefault()
          run()
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [map, enabled])
}
