import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/client'
import { setRateLimit } from '../api/hooks'
import { toast } from './toasts'

const titles: Record<ApiError['kind'], string> = {
  validation: 'That request was not valid',
  not_found: 'Not found',
  ai: 'Claude could not finish that',
  rate_limited: 'Claude usage limit reached',
  conflict: 'That conflicts with a change made elsewhere',
  internal: 'Something went wrong'
}

/** Routes an error to the right surface: rate limits feed the banner, the rest become toasts. */
export function reportError(qc: QueryClient, error: unknown, silent: boolean): void {
  if (error instanceof ApiError && error.kind === 'rate_limited') {
    setRateLimit(qc, { resetAt: error.resetAt, message: error.message })
    return
  }
  if (silent) return
  if (error instanceof ApiError) toast({ tone: 'error', title: titles[error.kind], body: error.message })
  else
    toast({
      tone: 'error',
      title: titles.internal,
      body: error instanceof Error ? error.message : String(error)
    })
}

const noRetry = new Set<ApiError['kind']>(['validation', 'not_found', 'rate_limited', 'conflict'])

export function createQueryClient(options: { retry?: boolean } = {}): QueryClient {
  const qc: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => reportError(qc, error, query.meta?.silent === true)
    }),
    mutationCache: new MutationCache({
      onError: (error, _vars, _ctx, mutation) => reportError(qc, error, mutation.meta?.silent === true)
    }),
    defaultOptions: {
      queries: {
        staleTime: 5_000,
        refetchOnWindowFocus: false,
        retry:
          options.retry === false
            ? false
            : (count, error) => !(error instanceof ApiError && noRetry.has(error.kind)) && count < 1
      },
      mutations: { retry: false }
    }
  })
  return qc
}
