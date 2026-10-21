import { useSettings } from '../../api/hooks'
import { Button, EmptyState, Skeleton } from '../../components'
import { ConnectionSection } from './ConnectionSection'
import { ModelsSection } from './ModelsSection'
import { PortalSection } from './PortalSection'
import { UsageSection } from './UsageSection'
import { AppearanceSection, WorkSection } from './WorkSection'

/** Settings: AI connection, models, background work, language and theme, usage. Saved as you go. */
export function SettingsScreen(): React.JSX.Element {
  const settings = useSettings()
  const s = settings.data
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-7 px-8 py-9">
        <header className="flex flex-col gap-1">
          <h1 className="font-serif text-2xl font-semibold">Settings</h1>
          <p className="text-sm text-graphite">Changes are saved as you make them.</p>
        </header>
        {settings.isPending ? (
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-28 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : !s ? (
          <EmptyState
            icon="alert"
            title="Settings did not load"
            actions={<Button onClick={() => void settings.refetch()}>Try again</Button>}
          >
            {settings.error?.message}
          </EmptyState>
        ) : (
          <>
            <ConnectionSection settings={s} />
            <ModelsSection settings={s} />
            <WorkSection settings={s} />
            <AppearanceSection settings={s} />
            <PortalSection />
            <UsageSection settings={s} />
          </>
        )}
      </div>
    </div>
  )
}
