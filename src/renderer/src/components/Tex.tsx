import katex from 'katex'
import { memo, useMemo } from 'react'
import { cx } from './cx'

/** KaTeX options shared with the Markdown pipeline. `trust: false` blocks \href, \url, \includegraphics. */
export const katexOptions = {
  throwOnError: false,
  strict: 'ignore',
  trust: false,
  output: 'htmlAndMathml'
} as const

interface TexProps {
  /** LaTeX without $ delimiters. */
  latex: string
  display?: boolean
  className?: string
}

/**
 * Renders one formula with KaTeX. KaTeX escapes all text it emits and `trust: false` disables
 * every command that could produce links or embeds, so its HTML is safe to inject.
 */
export const Tex = memo(function Tex({ latex, display = false, className }: TexProps): React.JSX.Element {
  const html = useMemo(
    () => katex.renderToString(latex, { ...katexOptions, displayMode: display }),
    [latex, display]
  )
  const Tag = display ? 'div' : 'span'
  return (
    <Tag
      className={cx(display && 'overflow-x-auto overflow-y-hidden py-1', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})
