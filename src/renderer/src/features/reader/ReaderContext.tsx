import { createContext, useContext } from 'react'

export interface ReaderApi {
  docId: string
  /** Current 1-based page. */
  page: number
  numPages: number
  /** Scroll the viewer to a page with a highlight flash (citations, course map, search). */
  jumpTo: (page: number) => void
}

export const ReaderContext = createContext<ReaderApi | null>(null)

/** Reader state for anything inside the book screen (study panel tabs, chat citations). */
export function useReader(): ReaderApi {
  const ctx = useContext(ReaderContext)
  if (!ctx) throw new Error('useReader must be used inside the book screen')
  return ctx
}
