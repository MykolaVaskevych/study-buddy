import { cx, Icon, IconButton } from '../components'
import type { IconName } from '../components'
import { useToasts } from './toasts'
import type { ToastTone } from './toasts'

const toneIcon: Record<ToastTone, IconName> = { info: 'sparkle', error: 'alert', ok: 'check' }
const toneClass: Record<ToastTone, string> = { info: 'text-accent', error: 'text-redpen', ok: 'text-ok' }

/** Bottom-right stack announced politely to screen readers. */
export function Toaster(): React.JSX.Element {
  const toasts = useToasts((s) => s.toasts)
  const dismiss = useToasts((s) => s.dismiss)
  return (
    <div
      aria-live="polite"
      aria-relevant="additions"
      className="pointer-events-none fixed right-4 bottom-10 z-40 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.tone === 'error' ? 'alert' : 'status'}
          className="pointer-events-auto flex animate-toast-in items-start gap-3 rounded-lg border border-rule bg-sheet p-3 shadow-pop"
        >
          <Icon name={toneIcon[t.tone]} size={18} className={cx('mt-0.5', toneClass[t.tone])} />
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{t.title}</p>
            {t.body ? <p className="mt-0.5 text-sm break-words text-graphite">{t.body}</p> : null}
          </div>
          <IconButton
            icon="close"
            label="Dismiss"
            size="sm"
            onClick={() => dismiss(t.id)}
            tooltipSide="left"
          />
        </div>
      ))}
    </div>
  )
}
