import { useEffect, useRef, useState } from 'react'
import type { Course, NameSuggestions } from '@shared/domain'
import { useRenameCourse, useRenameDocument, useSuggestNames } from '../../api/hooks'
import { toast } from '../../app/toasts'
import { Button, Dialog, Spinner } from '../../components'

interface Row {
  key: string
  label: string
  current: string
  value: string
  apply: boolean
}

function rowsFrom(s: NameSuggestions, course: Course, titleOf: (docId: string) => string): Row[] {
  return [
    { key: 'course', label: 'Course', current: course.name, value: s.name, apply: s.name !== course.name },
    ...s.files.map((f) => ({
      key: f.docId,
      label: 'File',
      current: titleOf(f.docId),
      value: f.title,
      apply: f.title !== titleOf(f.docId)
    }))
  ]
}

/**
 * "Suggest names with AI": the AI reads each file's chapters and first page and proposes a course
 * name and file titles. The student edits or unticks any of them; only ticked ones are renamed.
 */
export function NameSuggestionsDialog({
  course,
  titleOf,
  onClose
}: {
  course: Course
  titleOf: (docId: string) => string
  onClose: () => void
}): React.JSX.Element {
  const suggest = useSuggestNames()
  const renameCourse = useRenameCourse()
  const renameDoc = useRenameDocument()
  const [rows, setRows] = useState<Row[] | null>(null)
  const { mutate } = suggest
  // The names as they were when the dialog opened: renames while it is open must not re-ask the AI.
  const opened = useRef({ course, titleOf })

  useEffect(() => {
    const { course: c, titleOf: t } = opened.current
    mutate({ courseId: c.id }, { onSuccess: (s) => setRows(rowsFrom(s, c, t)) })
  }, [mutate])

  const update = (key: string, patch: Partial<Row>): void =>
    setRows((rs) => rs?.map((r) => (r.key === key ? { ...r, ...patch } : r)) ?? null)

  const apply = async (): Promise<void> => {
    const chosen = (rows ?? []).filter((r) => r.apply && r.value.trim() && r.value.trim() !== r.current)
    try {
      for (const r of chosen) {
        const name = r.value.trim()
        if (r.key === 'course') await renameCourse.mutateAsync({ courseId: course.id, name })
        else await renameDoc.mutateAsync({ docId: r.key, title: name })
      }
      if (chosen.length > 0) toast({ tone: 'ok', title: `Renamed ${chosen.length}` })
      onClose()
    } catch (err) {
      toast({
        tone: 'error',
        title: 'Some names were not saved',
        body: err instanceof Error ? err.message : ''
      })
    }
  }

  const busy = renameCourse.isPending || renameDoc.isPending
  return (
    <Dialog
      open
      onClose={onClose}
      title="Suggest names"
      description="Names from what the files contain. Edit or untick any you want to keep as they are."
      actions={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!rows || busy} loading={busy} onClick={() => void apply()}>
            Rename
          </Button>
        </>
      }
    >
      {suggest.isError ? (
        <p className="text-sm text-redpen">{suggest.error.message}</p>
      ) : !rows ? (
        <p className="flex items-center gap-2 text-sm text-graphite">
          <Spinner size={14} /> Reading your files…
        </p>
      ) : (
        <ul className="flex max-h-[60vh] flex-col gap-3 overflow-y-auto">
          {rows.map((r) => (
            <li key={r.key} className="flex items-start gap-3">
              <input
                type="checkbox"
                className="mt-2"
                aria-label={`Rename “${r.current}”`}
                checked={r.apply}
                onChange={(e) => update(r.key, { apply: e.target.checked })}
              />
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <input
                  aria-label={`New name for “${r.current}”`}
                  value={r.value}
                  onChange={(e) => update(r.key, { value: e.target.value, apply: true })}
                  className="rounded-sm border border-rule bg-sheet px-2 py-1 text-sm"
                />
                <span className="truncate text-xs text-faint">
                  {r.label}, now “{r.current}”
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Dialog>
  )
}
