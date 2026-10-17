import { useCallback } from 'react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import type { JobInfo } from '@shared/domain'
import { useApiEvents } from '../api/hooks'
import { useThemeSync } from './theme'
import { toast } from './toasts'

function AppEffects(): null {
  const onJobFailed = useCallback((job: JobInfo) => {
    toast({ tone: 'error', title: `${job.label} failed`, body: job.error ?? undefined })
  }, [])
  useApiEvents({ onJobFailed })
  useThemeSync()
  return null
}

/** Query cache, push-event wiring and theme for the whole app. */
export function Providers({
  client,
  children
}: {
  client: QueryClient
  children: ReactNode
}): React.JSX.Element {
  return (
    <QueryClientProvider client={client}>
      <AppEffects />
      {children}
    </QueryClientProvider>
  )
}
