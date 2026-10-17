import { Link, useParams } from 'react-router'
import { useCheatSheet } from '../../api/hooks'
import { Button, EmptyState, Icon, Skeleton, Tex } from '../../components'

/**
 * One-page revision sheet: per topic the core formulas (with meaning), key concepts and facts,
 * built from the index. Printable (Ctrl+P / "Print"), each topic links back to its pages.
 */
export function CheatSheetScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const sheet = useCheatSheet(docId)

  return (
    <div className="cheat-sheet h-full overflow-y-auto bg-paper">
      <header className="sticky top-0 z-10 flex items-center gap-3 border-b border-rule bg-paper px-6 py-3 print:static print:border-0">
        <Link
          to={`/book/${docId}`}
          aria-label="Back to the book"
          className="text-graphite hover:text-ink print:hidden"
        >
          <Icon name="arrow-left" size={18} />
        </Link>
        <h1 className="flex-1 font-serif text-lg font-semibold">
          Cheat sheet{sheet.data ? ` · ${sheet.data.title}` : ''}
        </h1>
        <Button size="sm" className="print:hidden" onClick={() => window.print()}>
          Print
        </Button>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-5">
        {sheet.isPending ? (
          <div className="grid gap-4 md:grid-cols-2">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-40" />
            ))}
          </div>
        ) : !sheet.data || sheet.data.sections.length === 0 ? (
          <EmptyState icon="notes" title="Nothing to summarise yet">
            The sheet fills in as the book is indexed. Open the book and let indexing finish.
          </EmptyState>
        ) : (
          <div className="columns-1 gap-5 md:columns-2 print:columns-2 print:text-[10pt]">
            {sheet.data.sections.map((s) => (
              <section
                key={`${s.topicId}-${s.pageStart}`}
                className="mb-5 break-inside-avoid rounded-lg border border-rule bg-sheet p-4 print:mb-3 print:p-2"
              >
                <h2 className="mb-2 flex items-baseline gap-2 font-serif font-semibold">
                  <span className="flex-1">{s.title}</span>
                  <Link
                    to={`/book/${docId}?page=${s.pageStart}`}
                    className="text-sm font-normal text-graphite hover:text-ink"
                  >
                    p. {s.pageStart}–{s.pageEnd}
                  </Link>
                </h2>
                {s.formulas.length > 0 && (
                  <ul className="mb-2 flex flex-col gap-1.5">
                    {s.formulas.map((f) => (
                      <li key={f.latex}>
                        <Tex latex={f.latex} display />
                        <p className="text-sm text-graphite">{f.meaning}</p>
                      </li>
                    ))}
                  </ul>
                )}
                {s.concepts.length > 0 && (
                  <dl className="mb-2 flex flex-col gap-1 text-[0.92rem]">
                    {s.concepts.map((c) => (
                      <div key={c.term}>
                        <dt className="inline font-semibold">{c.term}: </dt>
                        <dd className="inline">{c.definition}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {s.keyFacts.length > 0 && (
                  <ul className="list-disc pl-5 text-[0.92rem]">
                    {s.keyFacts.map((k) => (
                      <li key={k}>{k}</li>
                    ))}
                  </ul>
                )}
              </section>
            ))}
          </div>
        )}
      </main>
    </div>
  )
}
