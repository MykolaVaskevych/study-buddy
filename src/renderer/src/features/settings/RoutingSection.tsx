import { useId } from 'react'
import type { Effort, ModelTier } from '@shared/ai/provider'
import {
  ROUTED_TASKS,
  ROUTING_PRESETS,
  resolveRoutes,
  type RoutedTask,
  type RoutingPreset,
  type RoutingSettings
} from '@shared/ai/routing'
import type { PublicSettings } from '@shared/settings'
import { useUpdateSettings, useUsage } from '../../api/hooks'
import { cx } from '../../components'
import { fieldClass } from '../study/form'
import { SettingsSection } from './layout'

const PRESETS: { id: RoutingPreset; title: string; body: string }[] = [
  {
    id: 'balanced',
    title: 'Balanced (recommended)',
    body: 'Bulk drafting (flashcards, Test me) on the fast model, checked against the pages; weak batches redone on the strong one. The strong model keeps the course map, exam questions and teaching.'
  },
  {
    id: 'economy',
    title: 'Economy',
    body: 'Almost everything on the fast model: the most work before a usage limit, a little rougher.'
  },
  {
    id: 'quality',
    title: 'Best quality',
    body: 'All study material on the strong model. Uses your plan or budget fastest.'
  }
]

const EFFORTS: Effort[] = ['low', 'medium', 'high']

/** "$1.24 · 12 calls this month" from the usage summary, when the task was used. */
function spent(
  byTask: { task: string; usd: number; calls: number }[] | undefined,
  task: RoutedTask
): string | null {
  const row = byTask?.find((t) => t.task === task)
  if (!row || row.calls === 0) return null
  return `$${row.usd.toFixed(2)} · ${row.calls} call${row.calls === 1 ? '' : 's'} this month`
}

/**
 * Which model does which job: a preset (balanced by default) plus per-task changes. The fast model
 * costs a fraction of the strong one, so bulk drafting goes there and the app's own checks (quotes
 * found on the page, blind answer-key check) catch what it gets wrong.
 */
export function RoutingSection({ settings }: { settings: PublicSettings }): React.JSX.Element | null {
  const update = useUpdateSettings()
  const usage = useUsage()
  const name = useId()
  if (settings.provider === 'fake') return null
  const routing = settings.aiRouting
  const routes = resolveRoutes(routing)
  const models = settings.models[settings.provider]
  const save = (next: Partial<RoutingSettings>): void => update.mutate({ aiRouting: { ...routing, ...next } })
  const setRoute = (task: RoutedTask, tier: ModelTier, effort: Effort): void => {
    const preset = ROUTING_PRESETS[routing.preset][task]
    const others = routing.overrides.filter((o) => o.task !== task)
    save({
      overrides:
        preset.tier === tier && preset.effort === effort ? others : [...others, { task, tier, effort }]
    })
  }

  return (
    <SettingsSection
      title="Which model does what"
      description={`The fast model (${models.fast}) costs a fraction of the strong one (${models.smart}) and uses far less of a subscription's limit. Pick a plan, or change single jobs below.`}
    >
      <fieldset className="flex flex-col gap-3">
        <legend className="sr-only">Routing plan</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          {PRESETS.map((p) => {
            const checked = routing.preset === p.id
            return (
              <label
                key={p.id}
                className={cx(
                  'flex cursor-pointer flex-col gap-1 rounded-lg border p-4 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
                  checked ? 'border-accent bg-accent-soft' : 'border-rule bg-sheet hover:border-rule-strong'
                )}
              >
                <input
                  type="radio"
                  name={name}
                  className="sr-only"
                  checked={checked}
                  // A new plan starts clean: earlier per-job changes were made against the old one.
                  onChange={() => save({ preset: p.id, overrides: [] })}
                />
                <span className="font-semibold text-ink">{p.title}</span>
                <span className="text-sm text-graphite">{p.body}</span>
              </label>
            )
          })}
        </div>
      </fieldset>

      <table className="w-full text-sm">
        <caption className="sr-only">Model and effort for each job</caption>
        <thead>
          <tr className="text-left text-xs text-graphite">
            <th className="py-1 font-semibold">Job</th>
            <th className="py-1 font-semibold">Model</th>
            <th className="py-1 font-semibold">Effort</th>
          </tr>
        </thead>
        <tbody>
          {ROUTED_TASKS.map(({ task, label, description }) => {
            const route = routes[task]
            const changed = routing.overrides.some((o) => o.task === task)
            const cost = spent(usage.data?.byTask, task)
            return (
              <tr key={task} className="border-t border-rule align-top">
                <td className="py-2 pr-4">
                  <div className="font-semibold text-ink">
                    {label}
                    {changed ? (
                      <button
                        type="button"
                        className="ml-2 text-xs font-normal text-accent underline"
                        onClick={() => {
                          const preset = ROUTING_PRESETS[routing.preset][task]
                          setRoute(task, preset.tier, preset.effort)
                        }}
                      >
                        reset
                      </button>
                    ) : null}
                  </div>
                  <div className="text-graphite">{description}</div>
                  {cost ? <div className="tabular text-xs text-faint">{cost}</div> : null}
                </td>
                <td className="py-2 pr-4">
                  <select
                    aria-label={`Model for ${label}`}
                    value={route.tier}
                    onChange={(e) => setRoute(task, e.target.value as ModelTier, route.effort)}
                    className={cx(fieldClass, 'h-8 pr-8')}
                  >
                    <option value="fast">Fast ({models.fast})</option>
                    <option value="smart">Strong ({models.smart})</option>
                  </select>
                </td>
                <td className="py-2">
                  <select
                    aria-label={`Effort for ${label}`}
                    value={route.effort}
                    onChange={(e) => setRoute(task, route.tier, e.target.value as Effort)}
                    className={cx(fieldClass, 'h-8 pr-8')}
                  >
                    {EFFORTS.map((effort) => (
                      <option key={effort} value={effort}>
                        {effort}
                      </option>
                    ))}
                  </select>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="mt-1"
          checked={routing.escalate}
          onChange={(e) => save({ escalate: e.target.checked })}
        />
        <span>
          <span className="font-semibold text-ink">Redo weak batches on the strong model</span>
          <span className="block text-graphite">
            When most flashcards or Test-me questions from the fast model fail the check against the page,
            that batch is made once more on the strong model.
          </span>
        </span>
      </label>
    </SettingsSection>
  )
}
