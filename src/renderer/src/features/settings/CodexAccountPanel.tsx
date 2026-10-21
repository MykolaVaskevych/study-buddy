import { useState } from 'react'
import type { CodexLoginStart } from '@shared/ai/connections'
import {
  useCodexAccount,
  useCodexLogin,
  useCodexLoginCancel,
  useCodexLoginWait,
  useCodexLogout
} from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Badge, Button, Icon, SkeletonText } from '../../components'

/** Device sign-in: the page and the one-time code; Codex finishes on its own once it is entered. */
function DeviceStep({ start, onDone }: { start: CodexLoginStart; onDone: () => void }): React.JSX.Element {
  const cancel = useCodexLoginCancel()
  return (
    <div
      className="flex flex-col gap-3 rounded-lg border border-accent bg-accent-soft p-4"
      aria-live="polite"
    >
      <p className="font-semibold">Enter this code on the OpenAI sign-in page</p>
      <p className="text-sm text-graphite">
        Your browser opened the page. Sign in with the ChatGPT account that has your plan and enter the code.
        This finishes by itself; the code works for 15 minutes.
      </p>
      <p className="tabular font-mono text-2xl font-semibold tracking-widest select-all">{start.code}</p>
      <div className="flex flex-wrap gap-2">
        <a
          href={start.url}
          target="_blank"
          rel="noreferrer"
          className="text-sm font-medium text-accent underline"
        >
          Open the sign-in page again
        </a>
        <Button
          size="sm"
          variant="ghost"
          className="ml-auto"
          onClick={() => {
            cancel.mutate({})
            onDone()
          }}
        >
          Cancel
        </Button>
      </div>
    </div>
  )
}

/**
 * Codex (OpenAI's CLI) on this computer: its ChatGPT sign-in, driven from here. Signing out here
 * also signs out the terminal `codex`.
 */
export function CodexAccountPanel(): React.JSX.Element {
  const account = useCodexAccount()
  const login = useCodexLogin()
  const wait = useCodexLoginWait()
  const logout = useCodexLogout()
  const [pending, setPending] = useState<CodexLoginStart | null>(null)
  const a = account.data

  const start = (): void =>
    login.mutate(
      {},
      {
        onSuccess: (s) => {
          setPending(s)
          window.open(s.url, '_blank')
          wait.mutate(
            {},
            {
              onSuccess: (next) => {
                setPending(null)
                if (next.loggedIn)
                  toast({
                    tone: 'ok',
                    title: 'Signed in to Codex',
                    body: `Using your ${next.method ?? 'ChatGPT'} plan.`
                  })
              },
              onError: () => setPending(null)
            }
          )
        }
      }
    )

  if (account.isPending) return <SkeletonText lines={2} />
  if (!a)
    return (
      <p className="text-sm text-redpen">
        Could not check Codex: {account.error?.message ?? 'unknown error'}
      </p>
    )
  if (!a.installed)
    return (
      <p className="flex items-start gap-2 text-sm text-redpen">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        {a.problem}
      </p>
    )
  if (pending) return <DeviceStep start={pending} onDone={() => setPending(null)} />

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-3">
        {a.loggedIn ? (
          <>
            <Badge tone="ok" icon="check">
              Signed in
            </Badge>
            <span className="text-sm text-graphite">Codex uses your {a.method ?? 'ChatGPT'} plan.</span>
          </>
        ) : (
          <>
            <Badge tone="marker">Not signed in</Badge>
            <span className="text-sm text-graphite">
              Sign in with the ChatGPT account that has your plan.
            </span>
          </>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={a.loggedIn ? 'secondary' : 'primary'}
            loading={login.isPending}
            onClick={start}
          >
            {a.loggedIn ? 'Sign in again' : 'Sign in with ChatGPT'}
          </Button>
          {a.loggedIn ? (
            <Button size="sm" variant="ghost" loading={logout.isPending} onClick={() => logout.mutate({})}>
              Sign out
            </Button>
          ) : null}
        </span>
      </div>
      {a.problem ? <p className="text-sm text-redpen">{a.problem}</p> : null}
      {a.loggedIn ? (
        <p className="text-sm text-graphite">
          If requests fail with “sign-in expired”, press Sign in again. Signing out here signs out the
          terminal codex too.
        </p>
      ) : null}
      {login.error ? <p className="text-sm text-redpen">{login.error.message}</p> : null}
    </div>
  )
}
