import type { LlmProvider } from '@shared/ai/provider'
import { portalStepSchema, type PortalStepOutput } from '@shared/ai/schemas'
import { PORTAL_SYSTEM, buildPortalUser } from '../prompts/portal'
import type { WithUsage } from '../types'
import { usageRecord } from './common'

/** One step of driving the study portal (fast tier, text only: the page arrives as a snapshot). */
export async function portalStep(
  provider: LlmProvider,
  input: {
    goal: string
    page: string
    history: readonly string[]
    downloaded: readonly string[]
    step: number
    maxSteps: number
    signal?: AbortSignal
  }
): Promise<WithUsage<PortalStepOutput>> {
  const res = await provider.generate({
    task: 'portal',
    system: PORTAL_SYSTEM,
    parts: [{ type: 'text', text: buildPortalUser(input) }],
    schema: portalStepSchema,
    tier: 'fast',
    effort: 'low',
    ...(input.signal === undefined ? {} : { signal: input.signal })
  })
  return {
    value: { ...res.data, actions: res.data.actions.slice(0, 5) },
    usage: [usageRecord('portal', res)]
  }
}
