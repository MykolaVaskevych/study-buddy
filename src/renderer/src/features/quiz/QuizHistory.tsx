import { useQuizHistory } from '../../api/hooks'
import { Progress, Skeleton } from '../../components'
import { formatScore, scoreTone } from './Score'

const when = (iso: string): string =>
  new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Past quizzes on this book, newest first. */
export function QuizHistory({ docId }: { docId: string }): React.JSX.Element {
  const history = useQuizHistory(docId, 10)
  return (
    <section aria-labelledby="quiz-history" className="flex flex-col gap-3 border-t border-rule pt-7">
      <h2 id="quiz-history" className="font-serif text-lg font-semibold">
        Past quizzes
      </h2>
      {history.isPending ? (
        <Skeleton className="h-16 w-full" />
      ) : !history.data || history.data.length === 0 ? (
        <p className="text-sm text-graphite">No quizzes on this book yet. Your scores will show up here.</p>
      ) : (
        <ul className="flex max-w-xl flex-col divide-y divide-rule">
          {history.data.map((r) => {
            const ratio = r.maxScore > 0 ? r.score / r.maxScore : 0
            return (
              <li
                key={r.quizId}
                className="grid grid-cols-[9rem_minmax(0,1fr)_4.5rem] items-center gap-4 py-2.5 text-sm"
              >
                <span className="tabular text-graphite">{when(r.finishedAt)}</span>
                <Progress
                  value={ratio}
                  label={`Quiz of ${when(r.finishedAt)}`}
                  valueText={`${formatScore(r.score)} of ${r.maxScore}`}
                  tone={scoreTone(ratio)}
                  size="xs"
                />
                <span className="tabular text-right font-semibold">
                  {formatScore(r.score)}/{r.maxScore}
                </span>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
