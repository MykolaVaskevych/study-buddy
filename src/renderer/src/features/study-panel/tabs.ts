import type { ComponentType } from 'react'
import type { IndexStatus } from '@shared/domain'
import type { IconName } from '../../components'
import { CardsTab } from './CardsTab'
import { ChatTab } from './ChatTab'
import { NotesTab } from './NotesTab'
import { TestMeTab } from './TestMeTab'

/** Everything a study tab gets. Tabs follow the reader: `page` changes as the person scrolls. */
export interface StudyTabProps {
  docId: string
  /** Current 1-based absolute page. */
  page: number
  index: IndexStatus | null
  /** Jump the viewer to a cited page (with the highlight flash). */
  onCitation: (page: number) => void
}

export interface StudyTab {
  id: string
  label: string
  icon: IconName
  Component: ComponentType<StudyTabProps>
}

/**
 * Study panel tab registry. Keys 1–9 select tabs in this order.
 * Wave 2: replace a placeholder's `Component` (TestMeTab, CardsTab, ChatTab) with the real one,
 * or append a new entry. Nothing else in the panel needs to change.
 */
export const studyTabs: StudyTab[] = [
  { id: 'notes', label: 'Notes', icon: 'notes', Component: NotesTab },
  { id: 'test', label: 'Test me', icon: 'target', Component: TestMeTab },
  { id: 'cards', label: 'Cards', icon: 'cards', Component: CardsTab },
  { id: 'chat', label: 'Chat', icon: 'chat', Component: ChatTab }
]
