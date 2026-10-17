import { EmptyState, Markdown } from '../../components'
import type { StudyTabProps } from './tabs'

/**
 * Placeholder. Wave 3 (issue #8) replaces it. Render answers with
 * `<Markdown onCitation={onCitation}>`: "[p. N]" in the text becomes a button that jumps the
 * viewer to page N with the highlight flash.
 */
export function ChatTab({ page, onCitation }: StudyTabProps): React.JSX.Element {
  return (
    <div className="px-5 py-6">
      <EmptyState icon="chat" title="Ask about this page">
        <Markdown onCitation={onCitation}>
          {`Answers will cite the slides they come from, like [p. ${page}], so you can jump straight there. Arrives in a later build.`}
        </Markdown>
      </EmptyState>
    </div>
  )
}
