import { useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import type { QuizSession } from '@shared/domain'
import { useDocument, useTopics } from '../../api/hooks'
import { Icon, Skeleton } from '../../components'
import { QuizHistory } from './QuizHistory'
import { QuizRunner } from './QuizRunner'
import { QuizSetup } from './QuizSetup'
import type { ScopePreset } from './QuizSetup'
import type { RevealMode } from './run'

/** ?topic=<id> or ?from=N&to=M preselect the scope (links from the study panel and course map). */
export function presetFrom(params: URLSearchParams): ScopePreset | null {
  const topicId = params.get('topic')
  if (topicId) return { kind: 'topic', topicId }
  const from = Number(params.get('from'))
  const to = Number(params.get('to'))
  if (Number.isInteger(from) && Number.isInteger(to) && from >= 1 && to >= from)
    return { kind: 'range', from, to }
  return null
}

/** Quiz runner for one book. Route: /book/:docId/quiz */
export function QuizScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const doc = useDocument(docId)
  const topics = useTopics(docId)
  const [active, setActive] = useState<{ session: QuizSession; reveal: RevealMode } | null>(null)
  const onCitation = (page: number): void => void navigate(`/book/${encodeURIComponent(docId)}?page=${page}`)

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-8 py-8">
        <header className="flex flex-col gap-2">
          <Link
            to={`/book/${encodeURIComponent(docId)}`}
            className="inline-flex items-center gap-1.5 self-start rounded-sm text-sm text-graphite hover:text-ink"
          >
            <Icon name="arrow-left" size={16} />
            {doc.data?.title ?? 'Back to the book'}
          </Link>
          <h1 className="font-serif text-2xl font-semibold">
            {active ? (active.reveal === 'end' ? 'Exam' : 'Quiz') : 'New quiz'}
          </h1>
        </header>

        {active ? (
          <QuizRunner
            key={active.session.id}
            session={active.session}
            reveal={active.reveal}
            onCitation={onCitation}
            onNew={() => setActive(null)}
            onRetry={(session) => setActive({ session, reveal: 'instant' })}
          />
        ) : doc.data && !topics.isPending ? (
          <>
            <QuizSetup
              docId={docId}
              pageCount={doc.data.pageCount}
              topics={topics.data ?? []}
              preset={presetFrom(params)}
              onStart={(session, reveal) => setActive({ session, reveal })}
            />
            <QuizHistory docId={docId} />
          </>
        ) : (
          <div aria-hidden className="flex flex-col gap-4">
            <Skeleton className="h-8 w-72" />
            <Skeleton className="h-9 w-full max-w-xl" />
            <Skeleton className="h-8 w-96" />
          </div>
        )}
      </div>
    </div>
  )
}
