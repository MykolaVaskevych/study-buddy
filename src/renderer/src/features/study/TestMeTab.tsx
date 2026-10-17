import { useId, useState } from 'react'
import type { QuizSession } from '@shared/domain'
import { usePageCheckReady, usePageNotes, useStartPageCheck } from '../../api/hooks'
import { Badge, Button, EmptyState, Spinner } from '../../components'
import { QuestionSkeleton } from '../quiz/question/QuestionSkeleton'
import { useQuestionKeys } from '../quiz/question/useQuestionKeys'
import { kindLabel } from '../study-panel/notes/NoteSections'
import type { StudyTabProps } from '../study-panel/tabs'
import { PageCheckRun } from './PageCheckRun'
import { useSettledValue } from './useSettledValue'

const noop = (): void => undefined

function Start({
  docId,
  page,
  onStart,
  error
}: {
  docId: string
  page: number
  onStart: () => void
  error: string | null
}): React.JSX.Element {
  const settled = useSettledValue(page)
  const notes = usePageNotes(docId, settled)
  const ready = usePageCheckReady(docId, page)
  const data = notes.data?.page === page ? notes.data : null
  // Title, contents and blank pages: main refuses to test them, so don't offer it.
  const nothing = data?.indexed === true && !data.teachable
  useQuestionKeys({
    choices: 0,
    holdDigits: false,
    canReport: false,
    onChoice: noop,
    onReport: noop,
    onEnter: nothing ? noop : onStart
  })
  const titleId = useId()

  return (
    <section aria-labelledby={titleId} className="flex flex-col gap-5">
      <header className="flex items-center gap-3">
        <h2 id={titleId} className="tabular font-serif text-xl font-semibold">
          Page {page}
        </h2>
        {ready ? (
          <Badge tone="ok" icon="check">
            Questions ready
          </Badge>
        ) : null}
      </header>
      {nothing ? (
        <EmptyState size="sm" title="Nothing to test on this page">
          {data.kind ? `${kindLabel[data.kind]}. ` : ''}Move on to a page with content.
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-4">
          <p className="max-w-[44ch] text-md text-graphite">
            A few quick questions about this page, marked as you answer, with the reason behind each one.
          </p>
          <div>
            <Button variant="primary" shortcut="Enter" onClick={onStart}>
              Test me on page {page}
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="text-sm text-redpen">
          {error}
        </p>
      ) : null}
    </section>
  )
}

function Writing({ page }: { page: number }): React.JSX.Element {
  return (
    <div aria-busy="true" className="flex flex-col gap-5">
      <p role="status" className="flex items-center gap-2 text-sm text-graphite">
        <Spinner size={14} /> Writing questions about page {page}…
      </p>
      <QuestionSkeleton />
    </div>
  )
}

/**
 * "Test me": the read a page → get tested loop. Starts the page check for the page being read
 * (instant when main prefetched it), one question at a time with instant feedback. Asking again
 * on the same page gets questions not answered recently.
 */
export function TestMeTab({ docId, page, onCitation }: StudyTabProps): React.JSX.Element {
  const [session, setSession] = useState<QuizSession | null>(null)
  const [writing, setWriting] = useState<number | null>(null)
  const check = useStartPageCheck()
  // A session belongs to one book; switching books starts over.
  const current = session?.docId === docId ? session : null

  const start = (p: number): void => {
    setWriting(p)
    check.mutate(
      { docId, page: p },
      {
        onSuccess: (s) => {
          setSession(s)
          setWriting(null)
        },
        onError: () => setWriting(null)
      }
    )
  }

  return (
    <div className="px-5 py-5">
      {writing !== null ? (
        <Writing page={writing} />
      ) : current ? (
        <PageCheckRun
          key={current.id}
          session={current}
          readerPage={page}
          onStart={start}
          onCitation={onCitation}
        />
      ) : (
        <Start
          docId={docId}
          page={page}
          onStart={() => start(page)}
          error={check.error ? `The questions could not be written: ${check.error.message}` : null}
        />
      )}
    </div>
  )
}
