import { EmptyState } from '../components'
import type { IconName } from '../components'

interface PlaceholderProps {
  title: string
  icon: IconName
  body: string
}

/** Screen that exists in navigation but ships in a later build. */
export function Placeholder({ title, icon, body }: PlaceholderProps): React.JSX.Element {
  return (
    <div className="mx-auto w-full max-w-5xl px-10 py-10">
      <h1 className="mb-8 font-serif text-2xl font-semibold">{title}</h1>
      <EmptyState icon={icon} title="Not in this build yet">
        <p>{body}</p>
      </EmptyState>
    </div>
  )
}
