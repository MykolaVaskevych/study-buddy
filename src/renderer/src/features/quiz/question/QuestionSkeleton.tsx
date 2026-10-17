import { Skeleton, SkeletonText } from '../../../components'

/** Placeholder with the shape of a question, so the real one replaces it without a jump. */
export function QuestionSkeleton({ options = 4 }: { options?: number }): React.JSX.Element {
  return (
    <div aria-hidden className="flex flex-col gap-5">
      <Skeleton className="h-4 w-40" />
      <SkeletonText lines={2} />
      <div className="flex flex-col gap-2">
        {Array.from({ length: options }, (_, i) => (
          <div key={i} className="flex h-11 items-center gap-3 rounded-md border border-rule px-3">
            <div className="skeleton size-6 rounded-full" />
            <div className="skeleton h-3.5 flex-1" />
          </div>
        ))}
      </div>
      <Skeleton className="h-9 w-40 rounded-md" />
    </div>
  )
}
