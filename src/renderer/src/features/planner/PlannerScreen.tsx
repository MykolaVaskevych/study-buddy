import { useAutoTour } from '../tour/useAutoTour'
import { useToasts } from '../../app/toasts'
import { memo, useCallback, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router'
import { formatPercent } from '@shared/planner'
import type { ExamPlan, PlanTopic, StudyLevel } from '@shared/planner'
import type { DocumentDetail, Topic } from '@shared/domain'
import {
  useDocument,
  useIndexStatus,
  usePlan,
  usePlanTopics,
  useRebuildTopics,
  useImportPastPaper,
  useSavePlan,
  useStartIndex,
  useTopics
} from '../../api/hooks'
import { useShortcuts } from '../../app/shortcuts'
import { toast } from '../../app/toasts'
import { Badge, Button, buttonClass, EmptyState, Icon, Progress, Skeleton } from '../../components'
import { localDay, toLocalDay } from './dates'
import {
  changedTopicCount,
  defaultDraft,
  draftFromInput,
  sameInput,
  toPlanInput,
  withPin,
  withWeight
} from './draft'
import type { PlannerDraft } from './draft'
import { PlanForm } from './PlanForm'
import { ScheduleTimeline } from './ScheduleTimeline'
import { ScoreHeadline } from './ScoreHeadline'
import { bookPath } from './sessions'
import { buildRows, levelKey } from './triage'
import { TriageSection } from './TriageSection'
import { usePlannerPreview } from './usePlannerPreview'

/** Saved-state of the screen: no plan yet, matches the saved plan, edited, or re-planned since saving. */
type SaveState = 'new' | 'saved' | 'edited' | 'replanned'

const NO_TOPICS: Topic[] = []

const MemoTriage = memo(TriageSection)
const MemoSchedule = memo(ScheduleTimeline)

function Breadcrumb({ doc }: { doc: Pick<DocumentDetail, 'id' | 'title'> }): React.JSX.Element {
  return (
    <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm text-graphite">
      <Link to="/planner" className="hover:text-ink hover:underline">
        Planner
      </Link>
      <Icon name="chevron-right" size={14} className="shrink-0 text-faint" />
      <Link to={bookPath(doc.id)} className="truncate hover:text-ink hover:underline">
        {doc.title}
      </Link>
    </nav>
  )
}

function PlannerSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Loading the plan"
      className="mx-auto flex w-full max-w-[88rem] gap-10 px-8 py-8"
    >
      <div className="hidden w-[19rem] shrink-0 flex-col gap-6 lg:flex">
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full" />
        ))}
      </div>
      <div className="flex flex-1 flex-col gap-5">
        <Skeleton className="h-20 w-40" />
        <Skeleton className="h-4 w-full" />
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    </div>
  )
}

/** The planner needs topics; without them it explains how to get them and offers the next step. */
function NoTopics({ doc }: { doc: DocumentDetail }): React.JSX.Element {
  const indexQuery = useIndexStatus(doc.id)
  const start = useStartIndex()
  const rebuild = useRebuildTopics()
  const index = indexQuery.data ?? doc.index
  const running = index.state === 'running' || index.state === 'queued'
  const progress = index.totalPages > 0 ? index.indexedPages / index.totalPages : 0

  return (
    <div className="mx-auto w-full max-w-3xl px-10 py-10">
      <Breadcrumb doc={doc} />
      <h1 className="mt-2 mb-8 font-serif text-2xl font-semibold">Exam plan</h1>
      {index.state === 'done' ? (
        <EmptyState
          icon="map"
          title="Build the course map first"
          actions={
            <Button
              variant="primary"
              loading={rebuild.isPending}
              onClick={() => rebuild.mutate({ docId: doc.id })}
            >
              Build course map
            </Button>
          }
        >
          <p>
            Every page is indexed. The planner works from the course map: topics with page ranges, exam
            weights and time estimates.
          </p>
        </EmptyState>
      ) : (
        <EmptyState
          icon="map"
          title="Index the book first"
          actions={
            running ? null : (
              <Button
                variant="primary"
                icon="play"
                loading={start.isPending}
                onClick={() => start.mutate({ docId: doc.id })}
              >
                {index.state === 'paused' ? 'Resume indexing' : 'Index the book'}
              </Button>
            )
          }
        >
          <div className="flex flex-col gap-3">
            <p>
              The planner needs to know the topics, how much of the exam each one is worth and how long it
              takes. Indexing reads every page once; the plan opens here when it is done.
            </p>
            {index.indexedPages > 0 || running ? (
              <div className="flex flex-col gap-1.5">
                <p className="text-sm tabular">
                  {index.indexedPages} of {index.totalPages} pages indexed
                  {index.state === 'paused' ? ', paused' : ''}
                </p>
                <Progress
                  value={progress}
                  label="Pages indexed"
                  valueText={`${index.indexedPages} of ${index.totalPages} pages`}
                  tone="accent"
                  size="xs"
                />
              </div>
            ) : null}
          </div>
        </EmptyState>
      )}
    </div>
  )
}

interface EditorProps {
  doc: DocumentDetail
  planTopics: PlanTopic[]
  topics: Topic[]
  saved: ExamPlan | null
  today: string
}

function PlannerEditor({ doc, planTopics, topics, saved, today }: EditorProps): React.JSX.Element {
  const [draft, setDraft] = useState<PlannerDraft>(() =>
    saved ? draftFromInput(saved.input, today) : defaultDraft(today, toLocalDay(doc.examDate))
  )
  const input = useMemo(() => toPlanInput(draft), [draft])
  const preview = usePlannerPreview(planTopics, input, today)
  const { result } = preview
  const rows = useMemo(
    () => buildRows(planTopics, topics, preview.input, result),
    [planTopics, topics, preview.input, result]
  )
  const levels = useMemo(() => levelKey(result.items), [result.items])
  const pages = useMemo(() => new Map(topics.map((t) => [t.id, t.pageStart])), [topics])
  const pageOf = useCallback((topicId: string) => pages.get(topicId) ?? null, [pages])
  const save = useSavePlan()
  useAutoTour('planner')
  const pastPaper = useImportPastPaper()
  const pushToast = useToasts((t) => t.push)

  // Compare through the draft round trip so equivalent inputs never look edited.
  const savedInput = useMemo(
    () => (saved ? toPlanInput(draftFromInput(saved.input, today)) : null),
    [saved, today]
  )
  const state: SaveState =
    saved === null || savedInput === null
      ? 'new'
      : !sameInput(input, savedInput)
        ? 'edited'
        : sameInput(preview.input, savedInput) &&
            (levelKey(saved.result.items) !== levels ||
              Math.abs(saved.result.expectedScore - result.expectedScore) > 0.005)
          ? 'replanned'
          : 'saved'

  const onPin = useCallback(
    (id: string, level: StudyLevel | null) => setDraft((d) => withPin(d, id, level)),
    []
  )
  const onWeight = useCallback((id: string, w: number | null) => setDraft((d) => withWeight(d, id, w)), [])
  const onResetTopics = useCallback(() => setDraft((d) => ({ ...d, pins: {}, weights: {} })), [])

  const doSave = useCallback(() => {
    save.mutate(
      { docId: doc.id, input },
      {
        onSuccess: () =>
          toast({
            tone: 'ok',
            title: 'Plan saved',
            body: "Today's sessions now show at the top of your library."
          })
      }
    )
  }, [save, doc.id, input])
  useShortcuts(
    useMemo(
      () => ({ 'Mod+S': () => (state !== 'saved' && !save.isPending ? doSave() : undefined) }),
      [state, save.isPending, doSave]
    )
  )

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-10 border-b border-rule bg-paper">
        <div className="mx-auto flex w-full max-w-[88rem] flex-wrap items-center gap-x-6 gap-y-2 px-8 py-3">
          <div className="flex min-w-0 flex-col">
            <Breadcrumb doc={doc} />
            <h1 className="font-serif text-xl font-semibold">Exam plan</h1>
          </div>
          <p className="ml-auto text-sm text-graphite tabular" aria-hidden>
            Expected <span className="font-semibold text-ink">{formatPercent(result.expectedScore)}</span> for
            a {formatPercent(result.targetScore)} target
          </p>
          <div className="flex items-center gap-2">
            {state === 'new' ? (
              <Badge>Not saved yet</Badge>
            ) : state === 'edited' ? (
              <Badge tone="marker">Unsaved changes</Badge>
            ) : state === 'replanned' ? (
              <Badge tone="accent" icon="review">
                Updated for the time left and your quiz results
              </Badge>
            ) : (
              <Badge tone="ok" icon="check">
                Saved
              </Badge>
            )}
            {state === 'edited' && saved ? (
              <Button variant="ghost" size="sm" onClick={() => setDraft(draftFromInput(saved.input, today))}>
                Discard
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={pastPaper.isPending}
              data-tour="past-papers"
              title="Match past exam papers to topics and recalibrate exam weights"
              onClick={() =>
                pastPaper.mutate(
                  { docId: doc.id, paths: null },
                  {
                    onSuccess: (r) =>
                      pushToast(
                        r.questionsMapped === 0
                          ? {
                              tone: 'info',
                              title: 'No questions matched',
                              body: 'Pick a past paper PDF for this course.'
                            }
                          : {
                              tone: 'ok',
                              title: `Matched ${r.questionsMapped} past-paper questions`,
                              body: 'Exam weights updated from the papers; the plan re-solved.'
                            }
                      )
                  }
                )
              }
            >
              Past papers
            </Button>
            <Button
              variant="primary"
              size="sm"
              data-tour="save-plan"
              shortcut="Mod+S"
              loading={save.isPending}
              disabled={state === 'saved'}
              onClick={doSave}
            >
              Save plan
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[88rem] gap-x-12 gap-y-10 px-8 pt-7 pb-16 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <aside className="self-start lg:sticky lg:top-[5.75rem]">
          <PlanForm draft={draft} today={today} onChange={setDraft} />
        </aside>
        <div className="flex min-w-0 flex-col gap-14">
          <ScoreHeadline
            preview={preview}
            topics={planTopics}
            draft={draft}
            today={today}
            onChange={setDraft}
          />
          <MemoTriage
            rows={rows}
            docId={doc.id}
            plannedMinutes={result.plannedMinutes}
            levels={levels}
            changedTopics={changedTopicCount(draft)}
            onPin={onPin}
            onWeight={onWeight}
            onResetTopics={onResetTopics}
          />
          <MemoSchedule
            schedule={preview.schedule}
            docId={doc.id}
            today={today}
            examDate={preview.input.examDate}
            pageOf={pageOf}
          />
        </div>
      </div>
    </div>
  )
}

/** Route /book/:docId/plan: the exam triage planner for one book, solved live as you edit. */
export function PlannerScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const doc = useDocument(docId)
  const planTopics = usePlanTopics(docId)
  const saved = usePlan(docId)
  const topics = useTopics(docId)
  // One "today" per visit keeps the preview stable; the planner counts days from the local date.
  const [today] = useState(() => localDay(new Date()))

  if (doc.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-10 py-10">
        <EmptyState
          icon="alert"
          title="This book is not in your library"
          actions={
            <Link to="/planner" className={buttonClass('secondary')}>
              See all plans
            </Link>
          }
        >
          {doc.error.message}
        </EmptyState>
      </div>
    )
  }
  if (planTopics.isError || saved.isError) {
    return (
      <div className="mx-auto w-full max-w-3xl px-10 py-10">
        <EmptyState
          icon="alert"
          title="The plan did not load"
          actions={
            <Button
              onClick={() => {
                void planTopics.refetch()
                void saved.refetch()
              }}
            >
              Try again
            </Button>
          }
        >
          {(planTopics.error ?? saved.error)?.message}
        </EmptyState>
      </div>
    )
  }
  if (doc.isPending || planTopics.isPending || saved.isPending) return <PlannerSkeleton />
  if (planTopics.data.length === 0) return <NoTopics doc={doc.data} />
  return (
    <PlannerEditor
      key={docId}
      doc={doc.data}
      planTopics={planTopics.data}
      topics={topics.data ?? NO_TOPICS}
      saved={saved.data}
      today={today}
    />
  )
}
