import { cx, Markdown } from '../../components'
import { parseCloze } from './cloze'

interface ClozeTextProps {
  text: string
  /** false: gaps are blanks (front). true: answers are shown with the highlighter (back). */
  reveal: boolean
  className?: string
}

/** Markdown trims edge spaces of inline text; keep them so words don't run into a gap. */
function Edged({ text }: { text: string }): React.JSX.Element {
  const lead = /^\s/.test(text) ? ' ' : ''
  const trail = /\s$/.test(text) && text.trim() ? ' ' : ''
  return (
    <>
      {lead}
      {text.trim() ? <Markdown inline>{text.trim()}</Markdown> : null}
      {trail}
    </>
  )
}

/**
 * Card text with cloze gaps. Paragraphs without gaps render as normal Markdown; paragraphs with
 * gaps render inline segments around them, so math inside an answer (`{{c1::$\lambda^{-4}$}}`)
 * still goes through KaTeX.
 */
export function ClozeText({ text, reveal, className }: ClozeTextProps): React.JSX.Element {
  const blocks = text.split(/\n\s*\n/)
  return (
    <div className={cx('prose-study', className)}>
      {blocks.map((block, b) => {
        const segments = parseCloze(block)
        if (!segments.some((s) => s.kind === 'gap')) {
          return <Markdown key={b}>{block}</Markdown>
        }
        return (
          <p key={b}>
            {segments.map((s, i) =>
              s.kind === 'text' ? (
                <Edged key={i} text={s.text} />
              ) : reveal ? (
                <mark
                  key={i}
                  data-cloze="answer"
                  // The stroke leaves the top of the line unpainted; on a dark page that hides dark
                  // marker-ink glyphs (and superscripts), so dark mode fills the whole box.
                  className="marker-stroke rounded-xs bg-transparent font-semibold dark:bg-marker"
                >
                  <Markdown inline>{s.answer}</Markdown>
                </mark>
              ) : (
                <span
                  key={i}
                  data-cloze="gap"
                  className="mx-0.5 inline-block min-w-[3.5em] rounded-xs border-b-2 border-ink bg-sunken px-1.5 text-center text-faint"
                >
                  <span aria-hidden>{s.hint ? s.hint : '…'}</span>
                  <span className="sr-only">{s.hint ? `blank, hint: ${s.hint}` : 'blank'}</span>
                </span>
              )
            )}
          </p>
        )
      })}
    </div>
  )
}
