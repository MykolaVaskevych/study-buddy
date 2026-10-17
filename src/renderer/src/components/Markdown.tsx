import { memo, useMemo } from 'react'
import ReactMarkdown from 'react-markdown'
import type { Components, Options } from 'react-markdown'
import rehypeKatex from 'rehype-katex'
import remarkMath from 'remark-math'
import { remarkCitations } from './citations'
import { cx } from './cx'
import { katexOptions } from './Tex'

interface MarkdownProps {
  children: string
  /** Called with the cited page when an inline "[p. N]" citation is clicked. */
  onCitation?: (page: number) => void
  className?: string
  /** Inline mode renders paragraphs as spans, for one-line content such as list items. */
  inline?: boolean
}

/** Only http(s) links survive; everything else (javascript:, file:, data:, sb-pdf:) is dropped. */
export function safeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.href : ''
  } catch {
    return ''
  }
}

const remarkPlugins: Options['remarkPlugins'] = [remarkMath, remarkCitations]
const rehypePlugins: Options['rehypePlugins'] = [[rehypeKatex, katexOptions]]

function pageAttr(value: unknown): number | null {
  const n = Number(value)
  return Number.isInteger(n) && n >= 1 ? n : null
}

/**
 * Markdown for AI-written content (notes, explanations, chat). Untrusted input, so:
 * - raw HTML is never rendered (react-markdown shows it as text; there is no rehype-raw);
 * - links are http(s) only and open in the system browser (main denies in-app navigation);
 * - images are not loaded, their alt text is shown instead;
 * - "[p. N]" citations become buttons that call `onCitation`.
 */
export const Markdown = memo(function Markdown({
  children,
  onCitation,
  className,
  inline = false
}: MarkdownProps): React.JSX.Element {
  const components = useMemo<Components>(
    () => ({
      a: ({ href, children: label }) => {
        const url = href ? safeUrl(href) : ''
        if (!url) return <span>{label}</span>
        return (
          <a href={url} target="_blank" rel="noopener noreferrer">
            {label}
          </a>
        )
      },
      img: ({ alt }) => (alt ? <span className="text-graphite italic">[{alt}]</span> : null),
      cite: ({ node, children: label }) => {
        const page = pageAttr(node?.properties['dataPage'])
        if (page === null) return <span>{label}</span>
        const end = pageAttr(node?.properties['dataPageEnd'])
        return (
          <button
            type="button"
            className="marker-stroke mx-px cursor-pointer rounded-xs font-sans text-[0.82em] font-semibold whitespace-nowrap not-italic"
            aria-label={end ? `Go to pages ${page} to ${end}` : `Go to page ${page}`}
            onClick={() => onCitation?.(page)}
            disabled={!onCitation}
          >
            {end ? `pp. ${page}–${end}` : `p. ${page}`}
          </button>
        )
      },
      ...(inline ? { p: ({ children: text }) => <span>{text}</span> } : {})
    }),
    [onCitation, inline]
  )

  const body = (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
      urlTransform={safeUrl}
    >
      {children}
    </ReactMarkdown>
  )
  return inline ? (
    <span className={className}>{body}</span>
  ) : (
    <div className={cx('prose-study', className)}>{body}</div>
  )
})
