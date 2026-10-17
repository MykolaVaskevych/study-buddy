import { EmptyState } from '../../components'
import type { StudyTabProps } from './tabs'

/**
 * Placeholder. Wave 2 (issue #6) replaces this component: start a page check with
 * `useStartPageCheck()` ({ docId, page }), answer with `useAnswerQuestion()`, finish with
 * `useFinishQuiz()`. `pageCheck.ready` events already invalidate the relevant queries.
 */
export function TestMeTab({ page }: StudyTabProps): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <EmptyState icon="target" title={`Test yourself on page ${page}`}>
        <p>
          A few quick questions about the page you just read, graded instantly, with the reason behind every
          answer. Arrives in the next build.
        </p>
      </EmptyState>
    </div>
  )
}
