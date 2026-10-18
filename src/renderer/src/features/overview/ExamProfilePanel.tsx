import { useState } from 'react'
import type { ExamProfile, FormulaUse } from '@shared/domain'
import { useExamProfile, useImportPastPaper, useRebuildCards, useSaveExamProfile } from '../../api/hooks'
import { useToasts } from '../../app/toasts'
import { Badge, Button, Skeleton, cx } from '../../components'

type Format = keyof ExamProfile['formats']

const FORMATS: { key: Format; label: string }[] = [
  { key: 'mcq', label: 'Multiple choice' },
  { key: 'written', label: 'Written answers' },
  { key: 'numeric', label: 'Calculations' }
]

const FORMULAS: { value: FormulaUse; label: string; hint: string }[] = [
  { value: 'none', label: 'Not needed', hint: 'No formulas or calculations in the exam' },
  { value: 'recognise', label: 'Know what they mean', hint: 'Understand relationships, no number crunching' },
  { value: 'apply', label: 'Calculate with them', hint: 'Numeric problems with formulas' }
]

const pct = (x: number): string => `${Math.round(x * 100)} %`

/**
 * "Your exam": the profile every generator follows (card decks, question types, study book).
 * A past paper fills it in; the student can set or correct it. Saving offers to re-fit the cards.
 */
export function ExamProfilePanel({
  docId,
  highlight
}: {
  docId: string
  highlight: boolean
}): React.JSX.Element {
  const profile = useExamProfile(docId)
  const p = profile.data
  // Keyed by version so the form re-initialises when the stored profile changes (save, past paper).
  return p ? (
    <ProfileForm key={`${p.source}:${p.updatedAt ?? ''}`} docId={docId} p={p} highlight={highlight} />
  ) : (
    <Skeleton className="h-48" />
  )
}

function ProfileForm({
  docId,
  p,
  highlight
}: {
  docId: string
  p: ExamProfile
  highlight: boolean
}): React.JSX.Element {
  const save = useSaveExamProfile()
  const rebuild = useRebuildCards()
  const pastPaper = useImportPastPaper()
  const push = useToasts((t) => t.push)
  const [formats, setFormats] = useState<Set<Format>>(
    () => new Set(FORMATS.filter((f) => p.formats[f.key] >= 0.1).map((f) => f.key))
  )
  const [formulas, setFormulas] = useState<FormulaUse>(p.formulas)
  const [sheet, setSheet] = useState(p.formulaSheet)
  const [savedOnce, setSavedOnce] = useState(false)

  const toggle = (key: Format): void =>
    setFormats((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const onSave = (): void => {
    // Learnt shares are kept for formats still ticked; newly ticked ones get an even share.
    const learnt = p.source === 'past_paper' ? p.formats : null
    const share = (k: Format): number => (formats.has(k) ? (learnt && learnt[k] > 0 ? learnt[k] : 1) : 0)
    save.mutate(
      {
        docId,
        formats: { mcq: share('mcq'), written: share('written'), numeric: share('numeric') },
        formulas,
        formulaSheet: sheet
      },
      { onSuccess: () => setSavedOnce(true) }
    )
  }

  return (
    <section
      id="exam-profile"
      data-tour="exam-profile"
      className={cx(
        'rounded-lg border bg-sheet p-5',
        highlight ? 'border-accent ring-2 ring-accent' : 'border-rule'
      )}
    >
      <div className="mb-1 flex flex-wrap items-baseline gap-3">
        <h2 className="flex-1 font-serif text-lg font-semibold">Your exam</h2>
        <Badge tone={p.source === 'default' ? 'marker' : 'ok'}>
          {p.source === 'past_paper'
            ? 'Learnt from a past paper'
            : p.source === 'user'
              ? 'Set by you'
              : 'Not set yet'}
        </Badge>
      </div>
      <p className="mb-4 text-sm text-graphite">
        Flashcards, quick tests and the study book follow this, so they train what your exam actually asks.
      </p>

      <fieldset className="mb-4">
        <legend className="mb-1.5 text-sm font-semibold">Question types</legend>
        <div className="flex flex-wrap gap-2">
          {FORMATS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={formats.has(f.key)}
              onClick={() => toggle(f.key)}
              className={cx(
                'rounded-md border px-3 py-1.5 text-sm',
                formats.has(f.key) ? 'border-ink bg-ink text-paper' : 'border-rule-strong text-graphite'
              )}
            >
              {f.label}
              {p.source === 'past_paper' && p.formats[f.key] > 0 ? ` · ${pct(p.formats[f.key])}` : ''}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="mb-4">
        <legend className="mb-1.5 text-sm font-semibold">Formulas</legend>
        <div className="flex flex-col gap-1.5">
          {FORMULAS.map((f) => (
            <label key={f.value} className="flex items-baseline gap-2 text-sm">
              <input
                type="radio"
                name={`formulas-${docId}`}
                checked={formulas === f.value}
                onChange={() => setFormulas(f.value)}
              />
              <span className="font-medium">{f.label}</span>
              <span className="text-graphite">{f.hint}</span>
            </label>
          ))}
          <label className="mt-1 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sheet} onChange={(e) => setSheet(e.target.checked)} />A formula
            sheet is provided in the exam
          </label>
        </div>
      </fieldset>

      {p.style ? (
        <p className="mb-4 rounded-md bg-sunken p-3 text-sm">
          <span className="font-semibold">From your past paper: </span>
          {p.style}
          {p.examples.length > 0
            ? ` (${p.examples.length} example question${p.examples.length === 1 ? '' : 's'} kept)`
            : ''}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          variant="primary"
          size="sm"
          loading={save.isPending}
          disabled={formats.size === 0}
          onClick={onSave}
        >
          Save
        </Button>
        <Button
          size="sm"
          loading={pastPaper.isPending}
          onClick={() =>
            pastPaper.mutate(
              { docId, paths: null },
              {
                onSuccess: (r) => {
                  if (r.profile) setSavedOnce(true)
                  push(
                    r.profile
                      ? {
                          tone: 'ok',
                          title: 'Learnt from your past paper',
                          body: r.profile.style || 'Exam profile updated.'
                        }
                      : {
                          tone: 'info',
                          title: 'Nothing learnt',
                          body: 'Pick a past exam or quiz PDF for this course.'
                        }
                  )
                }
              }
            )
          }
        >
          Learn from a past paper
        </Button>
        {savedOnce ? (
          <Button
            size="sm"
            variant="secondary"
            loading={rebuild.isPending}
            onClick={() =>
              rebuild.mutate(
                { docId },
                {
                  onSuccess: (r) =>
                    push({
                      tone: 'ok',
                      title: 'Re-fitting flashcards to your exam',
                      body: `${r.suspended} cards that don't fit were suspended (not deleted); new decks for ${r.queued} topics are being written.`
                    })
                }
              )
            }
          >
            Rebuild flashcards for this exam
          </Button>
        ) : null}
      </div>
    </section>
  )
}
