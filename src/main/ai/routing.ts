import type { LlmProvider } from '@shared/ai/provider'
import type { Route, RoutedTask } from '@shared/ai/routing'

/**
 * The provider with each call's tier and effort taken from the routing for its task (what the study
 * modules ask for is the "best quality" default). Health checks pass through unchanged.
 */
export function routeProvider(provider: LlmProvider, routes: Record<RoutedTask, Route>): LlmProvider {
  return {
    id: provider.id,
    capabilities: provider.capabilities,
    health: (signal) => provider.health(signal),
    generate: (req) =>
      req.task === 'health' ? provider.generate(req) : provider.generate({ ...req, ...routes[req.task] }),
    stream: (req) =>
      req.task === 'health' ? provider.stream(req) : provider.stream({ ...req, ...routes[req.task] })
  }
}

/**
 * Whether a batch of drafts is weak enough to redo on the strong model. `good` counts the drafts
 * whose quote was found on the page: none came back, most failed that check, or fewer than half of
 * the requested items are good.
 */
export function weakBatch(returned: number, good: number, requested: number): boolean {
  if (requested <= 0) return false
  if (good === 0) return true
  if (returned > 0 && good / returned < 0.6) return true
  return good < Math.ceil(requested / 2)
}
