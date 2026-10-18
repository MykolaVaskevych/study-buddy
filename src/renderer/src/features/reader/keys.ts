import type { KeyLike } from '../../app/shortcuts'

export type ReaderAction =
  | { type: 'page'; delta: 1 | -1 }
  | { type: 'first' }
  | { type: 'last' }
  | { type: 'zoom'; dir: 1 | -1 }
  | { type: 'fitWidth' }
  | { type: 'togglePane'; side: 'left' | 'right' }
  | { type: 'tab'; index: number }
  | { type: 'bookmark' }

/**
 * Where the key was pressed. 'editable' = a text field (ignore everything), 'panel' = a side pane
 * that scrolls itself (PgUp/PgDn stay native), 'viewer' = the PDF or the page body.
 */
export type KeyContext = 'editable' | 'panel' | 'viewer'

/** Reader keymap, kept pure so it can be tested without a DOM. */
export function readerKeyAction(e: KeyLike, context: KeyContext): ReaderAction | null {
  if (context === 'editable') return null
  const mod = e.ctrlKey || e.metaKey
  if (mod && !e.altKey) {
    if (e.key === '=' || e.key === '+') return { type: 'zoom', dir: 1 }
    if (e.key === '-' || e.key === '_') return { type: 'zoom', dir: -1 }
    if (e.key === '0') return { type: 'fitWidth' }
    return null
  }
  if (mod || e.altKey) return null
  switch (e.key) {
    case 'j':
      return { type: 'page', delta: 1 }
    case 'k':
      return { type: 'page', delta: -1 }
    case 'g':
      return { type: 'first' }
    case 'G':
      return { type: 'last' }
    case 'PageDown':
      return context === 'viewer' ? { type: 'page', delta: 1 } : null
    case 'PageUp':
      return context === 'viewer' ? { type: 'page', delta: -1 } : null
    case '[':
      return { type: 'togglePane', side: 'left' }
    case ']':
      return { type: 'togglePane', side: 'right' }
    case 'b':
      return { type: 'bookmark' }
  }
  if (/^[1-9]$/.test(e.key)) return { type: 'tab', index: Number(e.key) - 1 }
  return null
}

/** Target page for a navigation action, clamped to the document; null if not a page action. */
export function targetPage(action: ReaderAction, current: number, numPages: number): number | null {
  const clamp = (p: number): number => Math.min(Math.max(1, p), Math.max(1, numPages))
  switch (action.type) {
    case 'page':
      return clamp(current + action.delta)
    case 'first':
      return 1
    case 'last':
      return clamp(numPages)
    default:
      return null
  }
}
