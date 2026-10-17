import { cx } from './cx'

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.userAgent)

const labels: Record<string, string> = {
  Mod: isMac ? '⌘' : 'Ctrl',
  Ctrl: isMac ? '⌃' : 'Ctrl',
  Alt: isMac ? '⌥' : 'Alt',
  Shift: isMac ? '⇧' : 'Shift',
  Enter: '↵',
  Esc: 'Esc',
  ArrowUp: '↑',
  ArrowDown: '↓',
  PageUp: 'PgUp',
  PageDown: 'PgDn'
}

/** Splits a shortcut such as "Mod+Shift+K" into display keys; "+" alone stays a key. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut === '+') return ['+']
  return shortcut
    .split(/\+(?!$)/)
    .filter((k) => k.length > 0)
    .map((k) => labels[k] ?? k)
}

/** Converts our shortcut notation to the aria-keyshortcuts format. */
export function ariaShortcut(shortcut: string): string {
  return shortcut.replace(/\bMod\b/g, isMac ? 'Meta' : 'Control').replace(/\bCtrl\b/g, 'Control')
}

interface KbdProps {
  /** e.g. "j", "Mod+O", "Shift+G". */
  keys: string
  className?: string
  tone?: 'default' | 'inverse'
}

/** Keyboard hint rendered as small key caps. */
export function Kbd({ keys, className, tone = 'default' }: KbdProps): React.JSX.Element {
  return (
    <span className={cx('inline-flex items-center gap-0.5', className)}>
      {shortcutKeys(keys).map((k, i) => (
        <kbd
          key={`${k}-${i}`}
          className={cx(
            'tabular inline-flex h-[1.35rem] min-w-[1.35rem] items-center justify-center rounded-sm border px-1 text-2xs leading-none font-semibold',
            tone === 'inverse'
              ? 'border-white/25 bg-white/10 text-current'
              : 'border-rule-strong border-b-2 bg-sheet text-graphite'
          )}
        >
          {k}
        </kbd>
      ))}
    </span>
  )
}
