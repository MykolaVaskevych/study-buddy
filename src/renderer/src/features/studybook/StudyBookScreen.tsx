import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import type { Lesson, Topic } from '@shared/domain'
import { useGenerateLessons, useJobs, useLessons, useTopics } from '../../api/hooks'
import { useToasts } from '../../app/toasts'
import { Button, EmptyState, Markdown, Skeleton, Spinner } from '../../components'
import { useAutoTour } from '../tour/useAutoTour'

function Exercise({ question, answer }: { question: string; answer: string }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <li className="rounded-md border border-rule bg-sheet p-4 print:break-inside-avoid">
      <Markdown>{question}</Markdown>
      {open ? (
        <div className="mt-3 border-t border-rule pt-3">
          <Markdown>{answer}</Markdown>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="mt-2 print:hidden" onClick={() => setOpen(true)}>
          Show answer
        </Button>
      )}
    </li>
  )
}

function Chapter({
  topic,
  lesson,
  writing,
  onWrite,
  onCitation
}: {
  topic: Topic
  lesson: Lesson | undefined
  writing: boolean
  onWrite: () => void
  onCitation: (page: number) => void
}): React.JSX.Element {
  return (
    <article
      id={`topic-${topic.id}`}
      className="scroll-mt-20 border-b border-rule pb-10 print:break-before-page"
    >
      <header className="mb-4 flex flex-wrap items-baseline gap-3">
        <h2 className="flex-1 font-serif text-2xl font-semibold">{topic.title}</h2>
        <Link
          to={`/book/${topic.docId}?page=${topic.pageStart}`}
          className="text-sm text-graphite hover:text-ink"
        >
          pp. {topic.pageStart}–{topic.pageEnd}
        </Link>
        {lesson && !writing ? (
          <Button size="sm" variant="ghost" className="print:hidden" onClick={onWrite}>
            Rewrite
          </Button>
        ) : null}
      </header>
      {writing ? (
        <p className="flex items-center gap-2 text-graphite">
          <Spinner size={16} /> Writing this chapter from pages {topic.pageStart}–{topic.pageEnd}…
        </p>
      ) : lesson ? (
        <div className="flex flex-col gap-6">
          {lesson.sections.map((s) => (
            <section key={s.title}>
              <h3 className="mb-2 font-serif text-lg font-semibold">{s.title}</h3>
              <div className="leading-relaxed">
                <Markdown onCitation={onCitation}>{s.markdown}</Markdown>
              </div>
            </section>
          ))}
          {lesson.exercises.length > 0 ? (
            <section>
              <h3 className="mb-2 font-serif text-lg font-semibold">Try it</h3>
              <ol className="flex flex-col gap-3">
                {lesson.exercises.map((e) => (
                  <Exercise key={e.question} question={e.question} answer={e.answer} />
                ))}
              </ol>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="flex items-center gap-3 print:hidden">
          <p className="text-graphite">Not written yet.</p>
          <Button size="sm" onClick={onWrite}>
            Write this chapter
          </Button>
        </div>
      )}
    </article>
  )
}

/**
 * Route /book/:docId/studybook: an AI-written study book, one chapter per topic (the idea,
 * formulas with symbol tables, a worked example, exam traps, a one-minute summary, Try-it
 * exercises). Citations jump to the book; printable as a PDF.
 */
export function StudyBookScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const navigate = useNavigate()
  const topics = useTopics(docId)
  const lessons = useLessons(docId)
  const jobs = useJobs(docId)
  const generate = useGenerateLessons()
  const push = useToasts((t) => t.push)
  useAutoTour('studybook', topics.isSuccess)

  const leaves = (topics.data ?? []).filter((t) => !(topics.data ?? []).some((c) => c.parentId === t.id))
  const byTopic = new Map((lessons.data ?? []).map((l) => [l.topicId, l]))
  const writing = new Set(
    (jobs.data ?? [])
      .filter((j) => j.kind === 'write_lesson' && (j.state === 'queued' || j.state === 'running'))
      .map((j) => j.label)
  )
  const isWriting = (t: Topic): boolean => writing.has(`Study book: ${t.title}`)
  const missing = leaves.filter((t) => !byTopic.has(t.id) && !isWriting(t)).length
  const onCitation = (page: number): void => void navigate(`/book/${encodeURIComponent(docId)}?page=${page}`)
  const write = (topicId: string | null): void =>
    generate.mutate(
      { docId, topicId },
      {
        onSuccess: (r) =>
          push({
            tone: 'ok',
            title:
              r.queued === 0
                ? 'Study book is complete'
                : `Writing ${r.queued} chapter${r.queued === 1 ? '' : 's'}`,
            body: r.queued === 0 ? undefined : 'Chapters appear here as they finish; keep studying meanwhile.'
          })
      }
    )

  return (
    <div className="h-full overflow-y-auto bg-paper">
      <header className="sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-rule bg-paper px-8 py-3 print:static print:border-0">
        <Link to={`/book/${docId}`} className="text-sm text-graphite hover:text-ink print:hidden">
          ← Back to the book
        </Link>
        <h1 className="flex-1 font-serif text-xl font-semibold">Study book</h1>
        {missing > 0 ? (
          <span className="text-sm text-graphite print:hidden">
            {missing} chapter{missing === 1 ? '' : 's'} to write · about {missing} AI request
            {missing === 1 ? '' : 's'}
          </span>
        ) : null}
        <Button
          data-tour="write-all"
          variant="primary"
          size="sm"
          className="print:hidden"
          loading={generate.isPending}
          disabled={missing === 0}
          onClick={() => write(null)}
        >
          Write all chapters
        </Button>
        <Button size="sm" className="print:hidden" onClick={() => window.print()}>
          Print / PDF
        </Button>
      </header>

      <main className="mx-auto flex max-w-3xl flex-col gap-10 px-8 py-8">
        {topics.isPending ? (
          <Skeleton className="h-64" />
        ) : leaves.length === 0 ? (
          <EmptyState icon="book" title="No course map yet">
            Chapters are written per topic. Let the AI finish reading the book first (see Overview).
          </EmptyState>
        ) : (
          <>
            <nav
              data-tour="studybook-toc"
              aria-label="Chapters"
              className="rounded-lg border border-rule bg-sheet p-5"
            >
              <h2 className="mb-2 font-semibold">Contents</h2>
              <ol className="columns-1 gap-6 text-sm sm:columns-2">
                {leaves.map((t) => (
                  <li key={t.id} className="py-0.5">
                    <a
                      href={`#topic-${t.id}`}
                      onClick={(e) => {
                        e.preventDefault()
                        document.getElementById(`topic-${t.id}`)?.scrollIntoView({ behavior: 'smooth' })
                      }}
                      className="hover:underline"
                    >
                      {byTopic.has(t.id) ? '' : '○ '}
                      {t.title}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
            {leaves.map((t) => (
              <Chapter
                key={t.id}
                topic={t}
                lesson={byTopic.get(t.id)}
                writing={isWriting(t)}
                onWrite={() => write(t.id)}
                onCitation={onCitation}
              />
            ))}
          </>
        )}
      </main>
    </div>
  )
}
