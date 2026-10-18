import { useId, useState } from 'react'
import type { ClaudeAccount } from '@shared/ai/connections'
import {
  useClaudeAccount,
  useClaudeLogin,
  useClaudeLoginCancel,
  useClaudeLoginCode,
  useClaudeLogout
} from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Badge, Button, cx, Icon, SkeletonText } from '../../components'
import { fieldClass } from '../study/form'

const PLAN: Record<string, string> = {
  pro: 'Pro plan',
  max: 'Max plan',
  team: 'Team plan',
  enterprise: 'Enterprise plan'
}

function describe(a: ClaudeAccount): string {
  const who = a.email ?? 'Signed in'
  if (a.method === 'console') return `${who} · Console account (billed per request)`
  return a.plan ? `${who} · ${PLAN[a.plan] ?? a.plan}` : who
}

/** Second step of sign-in: the claude.ai page shows a code once the student approves. */
function CodeStep({ url, onDone }: { url: string | null; onDone: () => void }): React.JSX.Element {
  const submit = useClaudeLoginCode()
  const cancel = useClaudeLoginCancel()
  const [code, setCode] = useState('')
  const id = useId()
  return (
    <form
      className="flex flex-col gap-2 rounded-lg border border-accent bg-accent-soft p-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit.mutate(
          { code },
          {
            onSuccess: (a) => {
              onDone()
              toast({ tone: 'ok', title: 'Signed in to Claude', body: describe(a) })
            }
          }
        )
      }}
    >
      <label htmlFor={id} className="font-semibold">
        Paste the code from the sign-in page
      </label>
      <p className="text-sm text-graphite">
        Your browser opened the Claude sign-in page. Approve access there; it then shows a code to copy.
        {url ? (
          <>
            {' '}
            <a href={url} target="_blank" rel="noreferrer" className="font-medium text-accent underline">
              Open the sign-in page again
            </a>
          </>
        ) : null}
      </p>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          value={code}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setCode(e.target.value)}
          className={cx(fieldClass, 'min-w-0 flex-1 font-mono text-sm')}
        />
        <Button type="submit" variant="primary" loading={submit.isPending} disabled={code.trim() === ''}>
          Finish sign-in
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            cancel.mutate({})
            onDone()
          }}
        >
          Cancel
        </Button>
      </div>
    </form>
  )
}

/**
 * Claude Code's login, without a terminal: who is signed in, sign in (browser + code), switch
 * account, sign out. It is Claude Code's own login, so it is shared with `claude` in a terminal.
 */
export function ClaudeAccountPanel(): React.JSX.Element {
  const account = useClaudeAccount()
  const login = useClaudeLogin()
  const logout = useClaudeLogout()
  const [pending, setPending] = useState<{ url: string | null } | null>(null)
  const [confirmOut, setConfirmOut] = useState(false)
  const a = account.data

  const start = (method: 'claudeai' | 'console'): void =>
    login.mutate({ method }, { onSuccess: (r) => setPending({ url: r.url }) })

  if (account.isPending) return <SkeletonText lines={2} />
  if (!a)
    return (
      <p className="text-sm text-redpen">
        Could not check the Claude login: {account.error?.message ?? 'unknown error'}
      </p>
    )
  if (!a.installed)
    return (
      <p className="flex items-start gap-2 text-sm text-redpen">
        <Icon name="alert" size={16} className="mt-0.5 shrink-0" />
        {a.problem}
      </p>
    )
  if (pending) return <CodeStep url={pending.url} onDone={() => setPending(null)} />

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        {a.loggedIn ? (
          <>
            <Badge tone="ok" icon="check">
              Signed in
            </Badge>
            <span className="text-sm text-graphite">{describe(a)}</span>
          </>
        ) : (
          <>
            <Badge tone="marker">Not signed in</Badge>
            <span className="text-sm text-graphite">Sign in with the Claude account that has your plan.</span>
          </>
        )}
        <span className="ml-auto flex flex-wrap gap-2">
          {a.loggedIn ? (
            <>
              <Button size="sm" loading={login.isPending} onClick={() => start('claudeai')}>
                Switch account
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmOut(true)}>
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button size="sm" variant="primary" loading={login.isPending} onClick={() => start('claudeai')}>
                Sign in with Claude
              </Button>
              <Button size="sm" variant="ghost" onClick={() => start('console')}>
                Console account instead
              </Button>
            </>
          )}
        </span>
      </div>
      {a.problem ? <p className="text-sm text-redpen">{a.problem}</p> : null}
      {confirmOut ? (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-md bg-sunken p-3 text-sm">
          <span className="flex-1">This signs Claude Code out on this computer, in your terminal too.</span>
          <Button
            size="sm"
            variant="primary"
            loading={logout.isPending}
            onClick={() => logout.mutate({}, { onSuccess: () => setConfirmOut(false) })}
          >
            Sign out
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setConfirmOut(false)}>
            Keep me signed in
          </Button>
        </div>
      ) : null}
    </div>
  )
}
