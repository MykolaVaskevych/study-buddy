import type { PortalAgentState } from '@shared/domain'
import { Button, cx, Icon, Spinner } from '../../components'
import type { IconName } from '../../components'

const ICONS: Record<PortalAgentState['log'][number]['kind'], IconName> = {
  think: 'sparkle',
  click: 'chevron-right',
  skip: 'alert',
  file: 'check',
  error: 'alert',
  done: 'flag'
}

/** What "Get files with AI" is doing: the AI's thinking, each click, refusals and downloads. */
export function AgentPanel({
  agent,
  onStop,
  onClose
}: {
  agent: PortalAgentState
  onStop: () => void
  onClose: () => void
}): React.JSX.Element {
  const running = agent.status === 'running'
  const files = agent.downloaded.length
  return (
    <section
      aria-label="Get files with AI"
      className="flex max-h-56 shrink-0 flex-col gap-2 border-t border-rule bg-paper px-4 py-3"
    >
      <div className="flex items-center gap-3">
        {running ? <Spinner size={14} /> : <Icon name="sparkle" size={14} className="text-accent" />}
        <h2 className="text-sm font-semibold">
          {running
            ? `The AI is getting your files: step ${agent.step} of at most ${agent.maxSteps}`
            : agent.status === 'failed'
              ? 'The AI stopped with an error'
              : agent.status === 'stopped'
                ? 'Stopped'
                : 'Done'}
        </h2>
        <span className="tabular text-sm text-graphite">
          {files} file{files === 1 ? '' : 's'} downloaded
        </span>
        <div className="ml-auto">
          {running ? (
            <Button size="sm" variant="danger" onClick={onStop}>
              Stop
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onClose}>
              Close
            </Button>
          )}
        </div>
      </div>
      <ol aria-label="What the AI did" className="flex min-h-0 flex-col gap-1 overflow-y-auto text-sm">
        {agent.log.slice(-12).map((entry, i) => (
          <li
            key={`${entry.at}-${i}`}
            className={cx(
              'flex items-start gap-2',
              entry.kind === 'think' && 'text-graphite',
              entry.kind === 'skip' && 'text-faint',
              entry.kind === 'error' && 'text-redpen',
              entry.kind === 'file' && 'font-semibold text-ok'
            )}
          >
            <Icon name={ICONS[entry.kind]} size={14} className="mt-0.5 shrink-0" />
            <span>{entry.text}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}
