import type { ProviderId } from '@shared/ai/provider'
import type { DocId } from '@shared/domain'
import type { StudyAi, UsageRecord, WithUsage } from '../ai/types'
import { fatal } from './errors'
import type { PipelineDeps } from './types'

/**
 * Usage ledger and budget guard. Every AI call goes through `run`, so every UsageRecord lands in
 * the ledger (including verification passes) and the monthly budget is checked before each call.
 * The budget only applies to the anthropic-api provider: subscription usage is notional.
 */
export interface UsageLedger {
  /** Runs one StudyAi call with the current provider: budget check first, usage recorded after. */
  run<T>(docId: DocId | null, call: (ai: StudyAi) => Promise<WithUsage<T>>): Promise<T>
  record(docId: DocId | null, provider: ProviderId, records: readonly UsageRecord[]): void
  /** Throws a non-retryable AiError when the provider is billed and this month's cap is reached. */
  assertBudget(provider: ProviderId): void
}

export function createUsageLedger(deps: Pick<PipelineDeps, 'db' | 'aiFor' | 'now'>): UsageLedger {
  const { db } = deps

  const record: UsageLedger['record'] = (docId, provider, records) => {
    const at = deps.now().toISOString()
    for (const r of records)
      db.usage.record({ task: r.task, model: r.model, provider, docId, usage: r.usage }, at)
  }

  const assertBudget: UsageLedger['assertBudget'] = (provider) => {
    if (provider !== 'anthropic-api') return
    const budget = db.settings.get().monthlyBudgetUsd
    if (budget === null) return
    const spent = db.usage.monthSpendUsd(deps.now().toISOString())
    if (spent >= budget) {
      throw fatal(
        `Monthly AI budget reached: $${spent.toFixed(2)} of $${budget.toFixed(2)} spent this month. ` +
          'Raise the budget in Settings or switch to the Claude subscription provider.'
      )
    }
  }

  return {
    record,
    assertBudget,
    async run(docId, call) {
      const ai = deps.aiFor()
      assertBudget(ai.provider.id)
      const result = await call(ai)
      record(docId, ai.provider.id, result.usage)
      return result.value
    }
  }
}
