import { useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent, KeyboardEvent, ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { Course, DocumentSummary } from '@shared/domain'
import {
  useCourses,
  useCreateCourse,
  useDissolveCourse,
  useImportPdfs,
  useLibrary,
  useMoveDocument,
  useRenameCourse,
  useRenameDocument,
  useReorderCourses,
  useTopics
} from '../../api/hooks'
import { toast } from '../../app/toasts'
import { cx, Icon, IconButton, Skeleton, useDismiss } from '../../components'
import { resolveDrop } from '../library/useDropImport'
import { buildTopicTree } from '../reader/topicTree'
import { NameSuggestionsDialog } from './NameSuggestionsDialog'
import { dropMove, edgeAt, nudgeFile } from './tree'
import type { DragItem, DropTarget, TreeMove } from './tree'

const DRAG_TYPE = 'application/x-study-buddy-tree'

interface MenuItem {
  label: string
  onSelect: () => void
  disabled?: boolean
}

/** "⋯" button and right-click menu for a row. */
function RowMenu({
  label,
  items,
  open,
  onOpenChange
}: {
  label: string
  items: (MenuItem | 'separator')[]
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null)
  useDismiss(open, ref, () => onOpenChange(false))
  useEffect(() => {
    if (open) ref.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus()
  }, [open])
  return (
    <div ref={ref} className="relative">
      <IconButton
        icon="more"
        size="sm"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={cx('opacity-0 group-hover:opacity-100 focus-visible:opacity-100', open && 'opacity-100')}
      />
      {open ? (
        <div
          role="menu"
          aria-label={label}
          className="absolute top-full right-0 z-30 mt-1 flex w-60 flex-col rounded-md border border-rule bg-sheet py-1 shadow-lg"
        >
          {items.map((item, i) =>
            item === 'separator' ? (
              <hr key={`sep-${i}`} className="my-1 border-rule" />
            ) : (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={item.disabled}
                onClick={() => {
                  onOpenChange(false)
                  item.onSelect()
                }}
                className="px-3 py-1.5 text-left text-sm hover:bg-sunken focus-visible:bg-sunken disabled:text-faint disabled:hover:bg-transparent"
              >
                {item.label}
              </button>
            )
          )}
        </div>
      ) : null}
    </div>
  )
}

/** In-place rename: Enter or leaving the field saves, Escape cancels. */
function RenameField({
  value,
  label,
  onDone
}: {
  value: string
  label: string
  onDone: (name: string | null) => void
}): React.JSX.Element {
  const [text, setText] = useState(value)
  const done = useRef(false)
  const finish = (name: string | null): void => {
    if (done.current) return
    done.current = true
    onDone(name === null || name.trim() === '' || name.trim() === value ? null : name.trim())
  }
  return (
    <input
      aria-label={label}
      value={text}
      autoFocus
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => finish(text)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') finish(text)
        else if (e.key === 'Escape') finish(null)
        e.stopPropagation()
      }}
      className="min-w-0 flex-1 rounded-sm border border-accent bg-sheet px-1.5 py-0.5 text-sm outline-none"
    />
  )
}

/** Top-level topics of a file that is not open; each opens the file at that page. */
function FileTopics({ docId }: { docId: string }): React.JSX.Element {
  const topics = useTopics(docId)
  const navigate = useNavigate()
  if (topics.isPending) return <Skeleton className="mx-2 my-1.5 h-3.5 w-3/4" />
  const roots = buildTopicTree(topics.data ?? [])
  if (roots.length === 0) return <p className="px-2 py-1 text-xs text-faint">No course map yet</p>
  return (
    <ul aria-label="Topics">
      {roots.map(({ topic }) => (
        <li key={topic.id}>
          <button
            type="button"
            onClick={() => void navigate(`/book/${encodeURIComponent(docId)}?page=${topic.pageStart}`)}
            className="w-full truncate rounded-sm px-2 py-1 text-left text-sm text-graphite hover:bg-sunken hover:text-ink"
          >
            {topic.title}
          </button>
        </li>
      ))}
    </ul>
  )
}

const dropLine = (edge: DropTarget['edge'] | null): string =>
  edge === 'before'
    ? 'before:absolute before:inset-x-1 before:-top-px before:h-0.5 before:rounded-full before:bg-accent'
    : edge === 'after'
      ? 'after:absolute after:inset-x-1 after:-bottom-px after:h-0.5 after:rounded-full after:bg-accent'
      : edge === 'inside'
        ? 'ring-2 ring-accent ring-inset'
        : ''

interface CourseTreeProps {
  /** The open file; its course and topics are expanded. */
  docId: string
  /** What to show under the open file (its full course map). */
  activeContent: ReactNode
}

/**
 * Left pane in the reader, after Sidebery's tree tabs: courses, their files, and the open file's
 * topics. Drag files to reorder them or move them between courses, drag courses to reorder them,
 * drop files from the desktop onto a course to add them. F2 or a double-click renames.
 */
export function CourseTree({ docId, activeContent }: CourseTreeProps): React.JSX.Element {
  const navigate = useNavigate()
  const courses = useCourses()
  const library = useLibrary()
  const move = useMoveDocument()
  const reorder = useReorderCourses()
  const create = useCreateCourse()
  const dissolve = useDissolveCourse()
  const renameCourse = useRenameCourse()
  const renameDoc = useRenameDocument()
  const importFiles = useImportPdfs()
  const list = useMemo(() => courses.data ?? [], [courses.data])
  const docs = useMemo(
    () => new Map<string, DocumentSummary>((library.data ?? []).map((d) => [d.id, d])),
    [library.data]
  )
  const activeCourse = list.find((c) => c.docIds.includes(docId))?.id ?? null

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const [renaming, setRenaming] = useState<string | null>(null)
  const [menu, setMenu] = useState<string | null>(null)
  const [dragging, setDragging] = useState<DragItem | null>(null)
  const [drop, setDrop] = useState<DropTarget | null>(null)
  const [fileDrop, setFileDrop] = useState<string | null>(null)
  const [naming, setNaming] = useState<Course | null>(null)

  // The open file and its course start expanded, unless the student folded them.
  const isOpen = (id: string): boolean =>
    expanded.has(id) || ((id === docId || id === activeCourse) && !collapsed.has(id))
  const toggle = (id: string): void => {
    const open = isOpen(id)
    setExpanded((s) => {
      const next = new Set(s)
      if (open) next.delete(id)
      else next.add(id)
      return next
    })
    setCollapsed((s) => {
      const next = new Set(s)
      if (open) next.add(id)
      else next.delete(id)
      return next
    })
  }

  const apply = (change: TreeMove | null): void => {
    if (!change) return
    const onError = (err: Error): void =>
      toast({ tone: 'error', title: 'Could not move it', body: err.message })
    if (change.type === 'moveFile') {
      const { docId: moved, courseId, index } = change
      move.mutate({ docId: moved, courseId, index }, { onError })
      setExpanded((s) => new Set(s).add(courseId))
    } else reorder.mutate({ courseIds: change.courseIds }, { onError })
  }

  const addFiles = (courseId: string | null, paths: string[] | null): void =>
    importFiles.mutate(
      { paths, courseId },
      {
        onSuccess: (added) => {
          if (added.length > 0)
            toast({ tone: 'ok', title: `Added ${added.length} file${added.length === 1 ? '' : 's'}` })
        },
        onError: (err) => toast({ tone: 'error', title: 'Some files were not added', body: err.message })
      }
    )

  const titleOf = (id: string): string => docs.get(id)?.title ?? 'Untitled'

  const startDrag = (e: DragEvent, item: DragItem): void => {
    e.dataTransfer.setData(DRAG_TYPE, JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
    setDragging(item)
  }
  const endDrag = (): void => {
    setDragging(null)
    setDrop(null)
    setFileDrop(null)
  }
  const isDesktopFiles = (e: DragEvent): boolean => !dragging && e.dataTransfer.types.includes('Files')

  /** Drag-over for a row: a tree item shows where it would land, desktop files light up the course. */
  const over = (e: DragEvent, target: (edge: 'before' | 'after') => DropTarget, courseId: string): void => {
    if (isDesktopFiles(e)) {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
      setFileDrop(courseId)
      return
    }
    if (!dragging) return
    const t = target(edgeAt(e.clientY, e.currentTarget.getBoundingClientRect()))
    if (!dropMove(list, dragging, t)) {
      setDrop(null)
      return
    }
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    setDrop(t)
  }
  const dropOn = (e: DragEvent, target: (edge: 'before' | 'after') => DropTarget, courseId: string): void => {
    e.preventDefault()
    if (isDesktopFiles(e)) {
      const result = resolveDrop([...e.dataTransfer.files])
      if (result.paths && result.paths.length > 0) addFiles(courseId, result.paths)
      else toast({ tone: 'error', title: 'Only PDF, PowerPoint, Word and OpenDocument files can be added' })
    } else if (dragging) {
      apply(dropMove(list, dragging, target(edgeAt(e.clientY, e.currentTarget.getBoundingClientRect()))))
    }
    endDrag()
  }

  const renameKey = (e: KeyboardEvent, id: string): void => {
    if (e.key === 'F2') {
      e.preventDefault()
      setRenaming(id)
    }
  }

  const fileMenu = (course: Course, id: string): (MenuItem | 'separator')[] => [
    { label: 'Rename', onSelect: () => setRenaming(id) },
    { label: 'Move up', onSelect: () => apply(nudgeFile(list, id, -1)), disabled: course.docIds[0] === id },
    {
      label: 'Move down',
      onSelect: () => apply(nudgeFile(list, id, 1)),
      disabled: course.docIds.at(-1) === id
    },
    'separator',
    ...list
      .filter((c) => c.id !== course.id)
      .map((c) => ({
        label: `Move to ${c.name}`,
        onSelect: () => apply({ type: 'moveFile', docId: id, courseId: c.id, index: c.docIds.length })
      })),
    {
      label: 'Move to a new course',
      disabled: course.docIds.length === 1,
      onSelect: () => create.mutate({ name: titleOf(id), docIds: [id] })
    }
  ]

  const courseMenu = (course: Course): (MenuItem | 'separator')[] => [
    { label: 'Rename', onSelect: () => setRenaming(course.id) },
    { label: 'Suggest names with AI…', onSelect: () => setNaming(course) },
    { label: 'Add files…', onSelect: () => addFiles(course.id, null) },
    {
      label: 'Split into one course per file',
      disabled: course.docIds.length < 2,
      onSelect: () => dissolve.mutate({ courseId: course.id })
    }
  ]

  return (
    <div data-reader-panel data-tour="course-files" className="flex h-full flex-col">
      <div className="flex h-11 shrink-0 items-center justify-between pr-2 pl-4">
        <h2 className="text-sm font-semibold text-graphite">Courses</h2>
        <IconButton
          icon="plus"
          size="sm"
          label="Import files as a new course"
          disabled={importFiles.isPending}
          onClick={() => addFiles(null, null)}
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-4" tabIndex={-1}>
        {courses.isPending ? (
          <div className="flex flex-col gap-3 px-2 pt-1">
            <Skeleton className="h-4 w-3/5" />
            <Skeleton className="ml-5 h-3.5 w-4/5" />
            <Skeleton className="ml-5 h-3.5 w-2/3" />
          </div>
        ) : (
          <ul
            aria-label="Courses"
            className="flex flex-col gap-0.5"
            onDragEnd={endDrag}
            onDragLeave={(e) => {
              // Leaving the whole tree (not just moving between rows) clears the drop hints.
              if (!(e.relatedTarget instanceof Node && e.currentTarget.contains(e.relatedTarget))) {
                setDrop(null)
                setFileDrop(null)
              }
            }}
          >
            {list.map((course) => {
              const open = isOpen(course.id)
              const courseTarget = (edge: 'before' | 'after'): DropTarget =>
                dragging?.kind === 'course'
                  ? { kind: 'course', courseId: course.id, edge }
                  : { kind: 'course', courseId: course.id, edge: 'inside' }
              const lit = fileDrop === course.id
              return (
                <li key={course.id}>
                  <div
                    draggable={renaming !== course.id}
                    onDragStart={(e) => startDrag(e, { kind: 'course', courseId: course.id })}
                    onDragOver={(e) => over(e, courseTarget, course.id)}
                    onDragLeave={() => setFileDrop((c) => (c === course.id ? null : c))}
                    onDrop={(e) => dropOn(e, courseTarget, course.id)}
                    onContextMenu={(e) => {
                      e.preventDefault()
                      setMenu(course.id)
                    }}
                    className={cx(
                      'group relative flex h-8 items-center gap-1 rounded-md pr-1 hover:bg-sunken',
                      dropLine(drop?.kind === 'course' && drop.courseId === course.id ? drop.edge : null),
                      lit && 'bg-accent-soft ring-2 ring-accent ring-inset'
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={open}
                      aria-label={open ? `Collapse ${course.name}` : `Expand ${course.name}`}
                      onClick={() => toggle(course.id)}
                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-faint hover:text-ink"
                    >
                      <Icon
                        name="chevron-down"
                        size={14}
                        className={cx('transition-transform', !open && '-rotate-90')}
                      />
                    </button>
                    {renaming === course.id ? (
                      <RenameField
                        value={course.name}
                        label="Course name"
                        onDone={(name) => {
                          setRenaming(null)
                          if (name) renameCourse.mutate({ courseId: course.id, name })
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => toggle(course.id)}
                        onDoubleClick={() => setRenaming(course.id)}
                        onKeyDown={(e) => renameKey(e, course.id)}
                        className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
                      >
                        <span className="truncate text-sm font-semibold text-ink">{course.name}</span>
                        <span className="tabular shrink-0 text-xs text-faint">{course.docIds.length}</span>
                      </button>
                    )}
                    <RowMenu
                      label={`${course.name} options`}
                      items={courseMenu(course)}
                      open={menu === course.id}
                      onOpenChange={(o) => setMenu(o ? course.id : null)}
                    />
                  </div>
                  {open ? (
                    <ul
                      aria-label={`Files in ${course.name}`}
                      className="ml-3 flex flex-col gap-0.5 border-l border-rule pl-1"
                    >
                      {course.docIds.map((id) => {
                        const active = id === docId
                        const fileOpen = isOpen(id)
                        const doc = docs.get(id)
                        const fileTarget = (edge: 'before' | 'after'): DropTarget => ({
                          kind: 'file',
                          docId: id,
                          edge
                        })
                        return (
                          <li key={id}>
                            <div
                              draggable={renaming !== id}
                              onDragStart={(e) => startDrag(e, { kind: 'file', docId: id })}
                              onDragOver={(e) => over(e, fileTarget, course.id)}
                              onDrop={(e) => dropOn(e, fileTarget, course.id)}
                              onContextMenu={(e) => {
                                e.preventDefault()
                                setMenu(id)
                              }}
                              className={cx(
                                'group relative flex h-8 items-center gap-1 rounded-md pr-1',
                                active ? 'bg-marker-soft' : 'hover:bg-sunken',
                                dropLine(drop?.kind === 'file' && drop.docId === id ? drop.edge : null),
                                dragging?.kind === 'file' && dragging.docId === id && 'opacity-50'
                              )}
                            >
                              {active ? (
                                <span
                                  aria-hidden
                                  className="absolute inset-y-1 left-0 w-[3px] rounded-full bg-marker"
                                />
                              ) : null}
                              <button
                                type="button"
                                aria-expanded={fileOpen}
                                aria-label={
                                  fileOpen ? `Hide topics of ${titleOf(id)}` : `Show topics of ${titleOf(id)}`
                                }
                                onClick={() => toggle(id)}
                                className="inline-flex size-6 shrink-0 items-center justify-center rounded-sm text-faint hover:text-ink"
                              >
                                <Icon
                                  name="chevron-down"
                                  size={14}
                                  className={cx('transition-transform', !fileOpen && '-rotate-90')}
                                />
                              </button>
                              {renaming === id ? (
                                <RenameField
                                  value={titleOf(id)}
                                  label="File name"
                                  onDone={(title) => {
                                    setRenaming(null)
                                    if (title) renameDoc.mutate({ docId: id, title })
                                  }}
                                />
                              ) : (
                                <button
                                  type="button"
                                  aria-current={active ? 'page' : undefined}
                                  onClick={() => void navigate(`/book/${encodeURIComponent(id)}`)}
                                  onDoubleClick={() => setRenaming(id)}
                                  onKeyDown={(e) => renameKey(e, id)}
                                  title={titleOf(id)}
                                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                                >
                                  <Icon name="file" size={14} className="shrink-0 text-faint" />
                                  <span
                                    className={cx(
                                      'truncate text-sm',
                                      active ? 'font-semibold text-ink' : 'text-ink'
                                    )}
                                  >
                                    {titleOf(id)}
                                  </span>
                                  {doc && doc.cardsDue > 0 ? (
                                    <span className="tabular ml-auto shrink-0 rounded-sm bg-marker-soft px-1 text-2xs text-marker-ink">
                                      {doc.cardsDue}
                                    </span>
                                  ) : null}
                                </button>
                              )}
                              <RowMenu
                                label={`${titleOf(id)} options`}
                                items={fileMenu(course, id)}
                                open={menu === id}
                                onOpenChange={(o) => setMenu(o ? id : null)}
                              />
                            </div>
                            {fileOpen ? (
                              <div
                                data-tour={active ? 'course-map' : undefined}
                                className="ml-3 border-l border-rule pl-1"
                              >
                                {active ? activeContent : <FileTopics docId={id} />}
                              </div>
                            ) : null}
                          </li>
                        )
                      })}
                    </ul>
                  ) : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>
      {naming ? (
        <NameSuggestionsDialog course={naming} titleOf={titleOf} onClose={() => setNaming(null)} />
      ) : null}
    </div>
  )
}
