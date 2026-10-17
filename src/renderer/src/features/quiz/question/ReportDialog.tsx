import { useState } from 'react'
import { useReportQuestion } from '../../../api/hooks'
import { toast } from '../../../app/toasts'
import { Button, cx, Dialog } from '../../../components'
import { fieldClass } from '../../study/form'

const REASONS = [
  'The answer key is wrong',
  'The question is unclear',
  'The book does not cover this',
  'Something else'
] as const

interface ReportDialogProps {
  /** null = closed. */
  questionId: string | null
  onClose: () => void
  /** Called after the report was saved. */
  onReported: (questionId: string) => void
}

function ReportForm({
  questionId,
  onClose,
  onReported
}: {
  questionId: string
  onClose: () => void
  onReported: (questionId: string) => void
}): React.JSX.Element {
  const report = useReportQuestion()
  const [reason, setReason] = useState<string>(REASONS[0])
  const [detail, setDetail] = useState('')
  const submit = (): void => {
    const text = detail.trim() ? `${reason}: ${detail.trim()}` : reason
    report.mutate(
      { questionId, reason: text.slice(0, 500) },
      {
        onSuccess: () => {
          toast({ tone: 'ok', title: 'Question reported', body: 'It will not be asked again.' })
          onReported(questionId)
          onClose()
        }
      }
    )
  }
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <fieldset className="flex flex-col gap-1.5">
        <legend className="mb-1.5 text-sm font-semibold text-graphite">What is wrong with it?</legend>
        {REASONS.map((r, i) => (
          <label
            key={r}
            className={cx(
              'flex cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-focus',
              reason === r ? 'border-accent bg-accent-soft' : 'border-rule hover:border-rule-strong'
            )}
          >
            <input
              type="radio"
              name="reason"
              className="accent-[var(--color-accent)]"
              checked={reason === r}
              autoFocus={i === 0}
              onChange={() => setReason(r)}
            />
            {r}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-graphite">Details (optional)</span>
        <textarea
          rows={2}
          maxLength={400}
          value={detail}
          onChange={(e) => setDetail(e.target.value)}
          className={cx(fieldClass, 'h-auto resize-y py-2')}
        />
      </label>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={report.isPending}>
          Send report
        </Button>
      </div>
    </form>
  )
}

/** "Report bad question": the question is taken out of rotation and flagged for regeneration. */
export function ReportDialog({ questionId, onClose, onReported }: ReportDialogProps): React.JSX.Element {
  return (
    <Dialog
      open={questionId !== null}
      onClose={onClose}
      title="Report this question"
      description="Reported questions are not asked again."
    >
      {questionId !== null ? (
        <ReportForm questionId={questionId} onClose={onClose} onReported={onReported} />
      ) : null}
    </Dialog>
  )
}
