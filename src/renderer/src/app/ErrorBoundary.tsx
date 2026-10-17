import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button, EmptyState } from '../components'

function describe(error: unknown): string {
  if (isRouteErrorResponse(error)) return `${error.status} ${error.statusText}`
  if (error instanceof Error) return error.message
  return String(error)
}

function Crash({ error, onRetry }: { error: unknown; onRetry: () => void }): React.JSX.Element {
  return (
    <div role="alert" className="flex h-full items-center justify-center p-10">
      <EmptyState
        icon="alert"
        title="This screen stopped working"
        actions={
          <>
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
            <Button variant="ghost" onClick={() => window.location.assign('#/')}>
              Back to library
            </Button>
          </>
        }
      >
        <p>Your library and progress are safe. The error was:</p>
        <p className="mt-2 font-mono text-sm break-words text-ink">{describe(error)}</p>
      </EmptyState>
    </div>
  )
}

/** errorElement for routes: render errors and failed lazy imports land here. */
export function RouteError(): React.JSX.Element {
  const error = useRouteError()
  return <Crash error={error} onRetry={() => window.location.reload()} />
}

interface BoundaryProps {
  children: ReactNode
  /** Changing this resets the boundary (e.g. the current docId). */
  resetKey?: string
}

interface BoundaryState {
  error: unknown
}

/** Contains a crash to one region (a pane) so the rest of the app keeps working. */
export class ErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  override state: BoundaryState = { error: null }

  static getDerivedStateFromError(error: unknown): BoundaryState {
    return { error }
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error('[ui] render error', error, info.componentStack)
  }

  override componentDidUpdate(prev: BoundaryProps): void {
    if (prev.resetKey !== this.props.resetKey && this.state.error !== null) this.setState({ error: null })
  }

  override render(): ReactNode {
    if (this.state.error !== null)
      return <Crash error={this.state.error} onRetry={() => this.setState({ error: null })} />
    return this.props.children
  }
}
