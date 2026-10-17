import { useUiStore } from '../../app/uiStore'
import { Tabs } from '../../components'
import { studyTabs } from './tabs'
import type { StudyTabProps } from './tabs'

/** Right pane of the book screen. Tabs come from the registry in ./tabs.ts. */
export function StudyPanel(props: StudyTabProps): React.JSX.Element {
  const stored = useUiStore((s) => s.studyTab)
  const setTab = useUiStore((s) => s.setStudyTab)
  const active = studyTabs.find((t) => t.id === stored) ?? studyTabs[0]
  const items = studyTabs.map((t, i) => ({ id: t.id, label: t.label, icon: t.icon, shortcut: String(i + 1) }))
  if (!active) return <></>
  const { Component } = active
  return (
    <div data-reader-panel className="flex h-full flex-col">
      <Tabs
        label="Study panel"
        items={items}
        value={active.id}
        onValueChange={setTab}
        className="h-full"
        panelClassName="overflow-y-auto"
      >
        <Component {...props} />
      </Tabs>
    </div>
  )
}
