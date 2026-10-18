import { useId, useState } from 'react'
import { useSetApiKey } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Badge, Button, cx } from '../../components'
import { fieldClass } from '../study/form'

/** API key for the Anthropic API or an OpenAI-compatible server; never shown again once saved. */
export function ApiKeyField({
  hasKey,
  provider = 'anthropic-api',
  optional = false
}: {
  hasKey: boolean
  provider?: 'anthropic-api' | 'openai-compatible'
  /** Local servers usually run without a key. */
  optional?: boolean
}): React.JSX.Element {
  const anthropic = provider === 'anthropic-api'
  const setKey = useSetApiKey()
  const [replacing, setReplacing] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const inputId = useId()

  const save = (): void => {
    const key = value.trim()
    if (key.length < 10) {
      setError(
        anthropic
          ? 'That is too short to be an API key. Keys start with "sk-ant-".'
          : 'That is too short to be an API key.'
      )
      return
    }
    // Clear the field before sending: the key should not linger in the page.
    setValue('')
    setError(null)
    setKey.mutate(
      { apiKey: key, provider },
      {
        onSuccess: () => {
          setReplacing(false)
          toast({
            tone: 'ok',
            title: 'API key saved',
            body: 'It is stored encrypted by your system keychain.'
          })
        }
      }
    )
  }

  if (hasKey && !replacing) {
    return (
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="ok" icon="check">
          Key saved
        </Badge>
        <span className="text-sm text-graphite">Stored encrypted on this computer.</span>
        <span className="ml-auto flex gap-2">
          <Button size="sm" onClick={() => setReplacing(true)}>
            Replace key
          </Button>
          <Button
            size="sm"
            variant="ghost"
            loading={setKey.isPending}
            onClick={() =>
              setKey.mutate(
                { apiKey: null, provider },
                { onSuccess: () => toast({ tone: 'ok', title: 'API key removed' }) }
              )
            }
          >
            Remove key
          </Button>
        </span>
      </div>
    )
  }

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault()
        save()
      }}
    >
      <label htmlFor={inputId} className="font-semibold">
        {anthropic ? 'API key' : `Server API key${optional ? ' (optional)' : ''}`}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={inputId}
          type="password"
          name={anthropic ? 'anthropic-api-key' : 'server-api-key'}
          autoComplete="off"
          spellCheck={false}
          placeholder={anthropic ? 'sk-ant-…' : 'sk-…'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          aria-invalid={error !== null || undefined}
          aria-describedby={`${inputId}-help`}
          className={cx(fieldClass, 'min-w-0 flex-1 font-mono text-sm')}
        />
        <Button type="submit" variant="primary" loading={setKey.isPending} disabled={value.trim() === ''}>
          Save key
        </Button>
        {replacing ? (
          <Button variant="ghost" onClick={() => setReplacing(false)}>
            Cancel
          </Button>
        ) : null}
      </div>
      <p id={`${inputId}-help`} className={cx('text-sm', error ? 'text-redpen' : 'text-graphite')}>
        {error ??
          `Stored encrypted by your system keychain and only ever sent to ${anthropic ? 'Anthropic' : 'this server'}.`}
      </p>
    </form>
  )
}
