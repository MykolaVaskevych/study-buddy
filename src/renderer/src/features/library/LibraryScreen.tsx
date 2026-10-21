import { useAutoTour } from '../tour/useAutoTour'
import { useCallback, useMemo, useState } from 'react'
import type { Course, DocumentSummary } from '@shared/domain'
import { useCourses, useImportPdfs, useLibrary } from '../../api/hooks'
import { groupByCourse } from '../courses/tree'
import { toast } from '../../app/toasts'
import { useShortcuts } from '../../app/shortcuts'
import { Button, EmptyState } from '../../components'
import { TodayPanel } from '../planner/TodayPanel'
import { BookCard, BookCardSkeleton } from './BookCard'
import { LibrarySearch } from './LibrarySearch'
import { useDropImport } from './useDropImport'
import type { DropResult } from './useDropImport'

const steps = [
  ['Import a PDF', 'Slides and notes open instantly. Nothing is uploaded until you ask Claude for help.'],
  [
    'Read with notes beside every page',
    'Summaries, key formulas with their symbols, and exam traps, page by page.'
  ],
  ['Test yourself', 'Quick checks on the page you just read, and flashcards scheduled before the exam.'],
  [
    'Plan the time you have',
    'Enter the hours left; Study Buddy picks what to learn, what to skim and what to skip.'
  ]
] as const

function Welcome({ onImport, importing }: { onImport: () => void; importing: boolean }): React.JSX.Element {
  return (
    <section className="flex max-w-3xl flex-col gap-8 py-6">
      <div className="flex flex-col gap-3">
        <h2 className="font-serif text-3xl font-semibold text-balance">
          Bring the PDFs your exam is built on.
        </h2>
        <p className="max-w-[58ch] text-md text-graphite">
          Study Buddy turns lecture slides and notes into page notes, flashcards and quick checks, and plans
          what to study when time is short.
        </p>
      </div>
      <ol className="grid gap-x-10 gap-y-5 sm:grid-cols-2">
        {steps.map(([title, body], i) => (
          <li key={title} className="flex gap-3">
            <span className="tabular mt-0.5 font-serif text-lg font-semibold text-faint">{i + 1}</span>
            <span className="flex flex-col gap-0.5">
              <span className="font-semibold">{title}</span>
              <span className="text-sm text-graphite">{body}</span>
            </span>
          </li>
        ))}
      </ol>
      <div className="flex items-center gap-4">
        <Button
          data-tour="import"
          variant="primary"
          icon="import"
          onClick={onImport}
          loading={importing}
          shortcut="Mod+O"
        >
          Import files
        </Button>
        <span className="text-sm text-graphite">
          or drop PDF, PowerPoint or Word files anywhere on this window
        </span>
      </div>
    </section>
  )
}

const gridClass = 'grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5'

/** Courses with several files get a shelf each; single files share the last one. */
function Shelves({
  docs,
  courses,
  now
}: {
  docs: DocumentSummary[]
  courses: Course[]
  now: Date
}): React.JSX.Element {
  const groups = groupByCourse(docs, courses)
  return (
    <div className="flex flex-col gap-9">
      {groups.courses.map(({ course, docs: files }) => (
        <section key={course.id} aria-label={course.name} className="flex flex-col gap-3">
          <h2 className="flex items-baseline gap-2 font-serif text-lg font-semibold">
            {course.name}
            <span className="tabular font-sans text-sm font-normal text-graphite">{files.length} files</span>
          </h2>
          <div className={gridClass}>
            {files.map((doc) => (
              <BookCard key={doc.id} doc={doc} now={now} />
            ))}
          </div>
        </section>
      ))}
      {groups.singles.length > 0 ? (
        <section aria-label="Books" className={gridClass}>
          {groups.singles.map((doc) => (
            <BookCard key={doc.id} doc={doc} now={now} />
          ))}
        </section>
      ) : null}
    </div>
  )
}

/** The library: every imported course, search across all of them, import by button or drop. */
export function LibraryScreen(): React.JSX.Element {
  const library = useLibrary()
  const courses = useCourses()
  const { mutate: importMutate, isPending: importing } = useImportPdfs()
  // One clock per render pass keeps every card's countdown consistent.
  const [now] = useState(() => new Date())
  useAutoTour('library', !library.isPending)

  const runImport = useCallback(
    (paths: string[] | null) => {
      importMutate(
        { paths },
        {
          onSuccess: (docs) => {
            if (docs.length === 0) return
            toast({
              tone: 'ok',
              title:
                docs.length === 1 ? `Imported ${docs[0]?.title ?? 'PDF'}` : `Imported ${docs.length} PDFs`,
              body: 'You can start reading now; notes appear as pages are indexed.'
            })
          }
        }
      )
    },
    [importMutate]
  )

  const onDrop = useCallback(
    ({ paths, rejected }: DropResult) => {
      if (rejected > 0)
        toast({
          tone: 'info',
          title: 'Only PDF, PowerPoint, Word and OpenDocument files can be imported',
          body: `${rejected} skipped.`
        })
      if (paths === null) {
        // The bridge can't see dropped file paths yet; let the person pick them instead.
        runImport(null)
        return
      }
      if (paths.length > 0) runImport(paths)
    },
    [runImport]
  )

  const { over, bind } = useDropImport(onDrop)
  useShortcuts(useMemo(() => ({ 'Mod+O': () => runImport(null) }), [runImport]))

  const docs = library.data ?? []

  return (
    <div {...bind} className="relative h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 px-10 py-9">
        <header className="flex flex-wrap items-center gap-x-6 gap-y-4">
          <h1 className="font-serif text-2xl font-semibold">Library</h1>
          {docs.length > 0 ? (
            <Button
              variant="primary"
              icon="import"
              className="ml-auto"
              onClick={() => runImport(null)}
              loading={importing}
              shortcut="Mod+O"
            >
              Import files
            </Button>
          ) : null}
          {docs.length > 0 ? (
            <div className="w-full">
              <LibrarySearch docs={docs} />
            </div>
          ) : null}
        </header>

        {docs.length > 0 ? <TodayPanel docs={docs} now={now} /> : null}

        {library.isPending ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-5">
            <BookCardSkeleton />
            <BookCardSkeleton />
            <BookCardSkeleton />
          </div>
        ) : library.isError ? (
          <EmptyState
            icon="alert"
            title="The library didn't load"
            actions={<Button onClick={() => void library.refetch()}>Try again</Button>}
          >
            {library.error.message}
          </EmptyState>
        ) : docs.length === 0 ? (
          <Welcome onImport={() => runImport(null)} importing={importing} />
        ) : (
          <Shelves docs={docs} courses={courses.data ?? []} now={now} />
        )}
      </div>

      {over ? (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-3 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-ink/40 bg-marker-soft/80"
        >
          <p className="font-serif text-xl font-semibold">Drop to import</p>
        </div>
      ) : null}
    </div>
  )
}
