import type { PublicSettings } from '@shared/settings'
import { useUsage } from '../../api/hooks'
import { Progress, Skeleton } from '../../components'
import { SettingsSection } from './layout'

const TASKS: Record<string, string> = {
  index: 'Reading pages',
  topics: 'Course map',
  cards: 'Flashcards',
  questions: 'Quiz questions',
  page_check: 'Page checks',
  grade: 'Marking answers',
  verify: 'Checking answer keys',
  explain: 'Explanations',
  chat: 'Chat',
  health: 'Connection tests'
}

const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })

/** This month's AI spend by task; notional when a subscription covers it. */
export function UsageSection({ settings }: { settings: PublicSettings }): React.JSX.Element {
  const usage = useUsage()
  const u = usage.data
  const budget = settings.provider === 'anthropic-api' ? settings.monthlyBudgetUsd : null
  return (
    <SettingsSection title="Usage this month">
      {!u ? (
        <Skeleton className="h-24 w-full" />
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
            <p className="tabular font-serif text-3xl font-semibold">{usd.format(u.monthUsd)}</p>
            <p className="tabular text-sm text-graphite">{usd.format(u.todayUsd)} today</p>
          </div>
          {u.notional ? (
            <p className="max-w-[60ch] text-sm text-graphite">
              Notional: your Claude subscription covers this. It shows what the same work would cost with an
              API key.
            </p>
          ) : budget !== null && budget > 0 ? (
            <div className="flex max-w-md flex-col gap-1.5">
              <Progress
                value={Math.min(1, u.monthUsd / budget)}
                label="Monthly budget used"
                valueText={`${usd.format(u.monthUsd)} of ${usd.format(budget)}`}
                tone={u.monthUsd >= budget ? 'redpen' : 'accent'}
                size="xs"
              />
              <p className="tabular text-sm text-graphite">
                {usd.format(u.monthUsd)} of your {usd.format(budget)} budget
              </p>
            </div>
          ) : null}
          {u.byTask.length > 0 ? (
            <table className="w-full max-w-lg text-sm">
              <thead>
                <tr className="border-b border-rule text-left text-graphite">
                  <th scope="col" className="py-1.5 font-semibold">
                    Work
                  </th>
                  <th scope="col" className="py-1.5 text-right font-semibold">
                    Requests
                  </th>
                  <th scope="col" className="py-1.5 text-right font-semibold">
                    Cost
                  </th>
                </tr>
              </thead>
              <tbody>
                {[...u.byTask]
                  .sort((a, b) => b.usd - a.usd)
                  .map((t) => (
                    <tr key={t.task} className="border-b border-rule">
                      <td className="py-1.5">{TASKS[t.task] ?? t.task}</td>
                      <td className="tabular py-1.5 text-right text-graphite">{t.calls}</td>
                      <td className="tabular py-1.5 text-right">{usd.format(t.usd)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-graphite">No AI work yet this month.</p>
          )}
        </div>
      )}
    </SettingsSection>
  )
}
