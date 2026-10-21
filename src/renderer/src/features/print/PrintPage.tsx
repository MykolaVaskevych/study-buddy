import { useEffect, useState } from 'react'
import { Markdown } from '../../components'

declare global {
  interface Window {
    /** Renders Markdown for printing; resolves once it is laid out with its fonts. */
    sbPrint?: (markdown: string, title: string) => Promise<void>
  }
}

const nextFrame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()))

/**
 * Print layout for Markdown lecture notes: the app's own Markdown and KaTeX rendering on white, A4
 * friendly. The main process loads this page in a hidden window, calls `window.sbPrint` and prints
 * the result to PDF, so a .md lecture imports like any PDF (with a real text layer).
 */
export function PrintPage(): React.JSX.Element {
  const [doc, setDoc] = useState<{ markdown: string; title: string; done: () => void } | null>(null)

  useEffect(() => {
    window.sbPrint = (markdown, title) => new Promise<void>((done) => setDoc({ markdown, title, done }))
    return () => {
      delete window.sbPrint
    }
  }, [])

  useEffect(() => {
    if (!doc) return
    document.title = doc.title
    let live = true
    void (async () => {
      await nextFrame()
      await document.fonts.ready
      await nextFrame()
      if (live) doc.done()
    })()
    return () => {
      live = false
    }
  }, [doc])

  return (
    <main className="mx-auto max-w-[46rem] bg-white px-2 py-4 text-[11pt] text-black print:max-w-none">
      {doc ? <Markdown>{doc.markdown}</Markdown> : null}
    </main>
  )
}
