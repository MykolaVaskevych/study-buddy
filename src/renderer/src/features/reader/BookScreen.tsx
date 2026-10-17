import { useAutoTour } from '../tour/useAutoTour'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useParams, useSearchParams } from 'react-router'
import { ApiError } from '../../api/client'
import { useDocument, useIndexStatus } from '../../api/hooks'
import { ErrorBoundary } from '../../app/ErrorBoundary'
import { useUiStore } from '../../app/uiStore'
import { Button, buttonClass, EmptyState, Skeleton } from '../../components'
import { studyTabs } from '../study-panel/tabs'
import { StudyPanel } from '../study-panel/StudyPanel'
import { CourseMap } from './CourseMap'
import { targetPage } from './keys'
import type { ReaderAction } from './keys'
import { PdfViewer } from './pdf/PdfViewer'
import type { PdfViewerHandle } from './pdf/PdfViewer'
import { usePdfDocument } from './pdf/usePdfDocument'
import { ReaderContext } from './ReaderContext'
import type { ReaderApi } from './ReaderContext'
import { ReaderToolbar } from './ReaderToolbar'
import { ResizeHandle } from './ResizeHandle'
import { useReaderKeys } from './useReaderKeys'
import { useReaderReporting } from './useReaderReporting'
import { stepZoom } from './zoom'

function ViewerSkeleton(): React.JSX.Element {
  return (
    <div
      aria-busy="true"
      aria-label="Opening the PDF"
      className="flex h-full flex-col items-center gap-4 overflow-hidden bg-desk p-4"
    >
      {[0, 1].map((i) => (
        <div
          key={i}
          className="aspect-[4/3] w-[min(100%,56rem)] shrink-0 rounded-xs bg-sheet p-10 shadow-page"
        >
          <Skeleton className="h-6 w-1/2" />
          <Skeleton className="mt-6 h-3.5 w-3/4" />
          <Skeleton className="mt-3 h-3.5 w-2/3" />
        </div>
      ))}
    </div>
  )
}

/** The reading screen: course map | PDF | study panel. Route: /book/:docId?page=N */
export function BookScreen(): React.JSX.Element {
  const { docId = '' } = useParams()
  const [params] = useSearchParams()
  const location = useLocation()
  const docQuery = useDocument(docId)
  const indexQuery = useIndexStatus(docId)
  const [attempt, setAttempt] = useState(0)
  const pdf = usePdfDocument(docId, attempt)
  useAutoTour('book', pdf.status === 'ready')
  const viewer = useRef<PdfViewerHandle>(null)
  const panes = useUiStore((s) => s.panes)
  const togglePane = useUiStore((s) => s.togglePane)
  const zoom = useUiStore((s) => s.zoom)
  const setZoom = useUiStore((s) => s.setZoom)
  const setStudyTab = useUiStore((s) => s.setStudyTab)
  const [factor, setFactor] = useState(1)

  const urlPage = Number(params.get('page')) || null
  const doc = docQuery.data
  const numPages = pdf.status === 'ready' ? pdf.doc.numPages : (doc?.pageCount ?? null)
  const [page, setPage] = useState<number | null>(null)
  const startPage = Math.max(1, Math.min(urlPage ?? doc?.lastPage ?? 1, numPages ?? Number.MAX_SAFE_INTEGER))
  const currentPage = page ?? startPage

  useReaderReporting(docId, doc ? currentPage : null)

  const jumpTo = useCallback((p: number) => viewer.current?.jumpTo(p, { flash: true }), [])

  // A navigation to this screen with ?page=N (search hit, citation link) jumps and flashes.
  const seenKey = useRef(location.key)
  useEffect(() => {
    if (seenKey.current === location.key) return
    seenKey.current = location.key
    if (urlPage) viewer.current?.jumpTo(urlPage, { flash: true })
  }, [location.key, urlPage])

  const zoomBy = useCallback(
    (dir: 1 | -1) => setZoom({ mode: 'scale', scale: stepZoom(factor, dir) }),
    [factor, setZoom]
  )
  const fit = useCallback(() => setZoom({ mode: 'fit' }), [setZoom])

  useReaderKeys((action: ReaderAction) => {
    if (action.type === 'zoom') zoomBy(action.dir)
    else if (action.type === 'fitWidth') fit()
    else if (action.type === 'togglePane') togglePane(action.side)
    else if (action.type === 'tab') {
      const tab = studyTabs[action.index]
      if (tab) setStudyTab(tab.id)
    } else if (numPages !== null) {
      const target = targetPage(action, currentPage, numPages)
      if (target !== null && target !== currentPage) viewer.current?.jumpTo(target)
    }
  })

  const reader = useMemo<ReaderApi>(
    () => ({ docId, page: currentPage, numPages: numPages ?? 0, jumpTo }),
    [docId, currentPage, numPages, jumpTo]
  )

  if (docQuery.isError) {
    const missing = docQuery.error instanceof ApiError && docQuery.error.kind === 'not_found'
    return (
      <div className="p-10">
        <EmptyState
          icon={missing ? 'library' : 'alert'}
          title={missing ? 'This book is not in your library' : 'The book did not open'}
          actions={
            <Link to="/" className={buttonClass('secondary')}>
              Back to library
            </Link>
          }
        >
          {missing
            ? 'It may have been removed. Import the PDF again to keep studying it.'
            : docQuery.error.message}
        </EmptyState>
      </div>
    )
  }

  const index = indexQuery.data ?? doc?.index

  return (
    <ReaderContext.Provider value={reader}>
      <div className="flex h-full">
        {panes.left.open ? (
          <>
            <aside aria-label="Course map" className="shrink-0 bg-paper" style={{ width: panes.left.width }}>
              {doc && index ? <CourseMap doc={doc} index={index} page={currentPage} onJump={jumpTo} /> : null}
            </aside>
            <ResizeHandle side="left" label="Resize course map" />
          </>
        ) : null}

        <section aria-label="Reader" className="flex min-w-0 flex-1 flex-col">
          <ReaderToolbar
            docId={docId}
            title={doc?.title ?? ''}
            page={currentPage}
            numPages={numPages}
            zoomFactor={factor}
            fitMode={zoom.mode === 'fit'}
            onJump={(p) => viewer.current?.jumpTo(p)}
            onZoom={zoomBy}
            onFit={fit}
          />
          <div data-tour="reader" className="min-h-0 flex-1">
            <ErrorBoundary resetKey={`${docId}:${attempt}`}>
              {pdf.status === 'ready' && doc ? (
                <PdfViewer
                  key={docId}
                  ref={viewer}
                  doc={pdf.doc}
                  firstPage={pdf.firstPage}
                  initialPage={startPage}
                  zoom={zoom}
                  onPageChange={setPage}
                  onZoomFactor={setFactor}
                  onZoomStep={zoomBy}
                />
              ) : pdf.status === 'error' ? (
                <div className="flex h-full items-center justify-center bg-desk p-10">
                  <EmptyState
                    icon="file"
                    title="The PDF did not open"
                    actions={<Button onClick={() => setAttempt((a) => a + 1)}>Try again</Button>}
                  >
                    <p>{pdf.error.message}</p>
                    <p className="mt-2">Notes and the course map still work while the file is unavailable.</p>
                  </EmptyState>
                </div>
              ) : (
                <ViewerSkeleton />
              )}
            </ErrorBoundary>
          </div>
        </section>

        {panes.right.open ? (
          <>
            <ResizeHandle side="right" label="Resize study panel" />
            <aside
              aria-label="Study panel"
              className="shrink-0 bg-paper"
              style={{ width: panes.right.width }}
            >
              <ErrorBoundary resetKey={docId}>
                <StudyPanel docId={docId} page={currentPage} index={index ?? null} onCitation={jumpTo} />
              </ErrorBoundary>
            </aside>
          </>
        ) : null}
      </div>
    </ReaderContext.Provider>
  )
}
