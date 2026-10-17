import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/atkinson-hyperlegible-next/wght.css'
import '@fontsource-variable/literata/opsz.css'
import '@fontsource-variable/literata/opsz-italic.css'
import 'katex/dist/katex.min.css'
import './styles/index.css'
import { setBridge } from './api/client'
import { setPdfSourceResolver } from './api/pdfSource'
import { App } from './App'

/** Outside Electron there is no preload bridge: run against the in-memory mock (browser mode). */
async function installMockIfNeeded(): Promise<void> {
  if (typeof window.api !== 'undefined') return
  const { createMockApi } = await import('./api/mock')
  const mock = createMockApi()
  setBridge(mock)
  setPdfSourceResolver(mock.pdfSource)
  Object.assign(window, { sbMock: mock })
  console.info('[sb] browser mode: using the mock api (window.sbMock)')
}

async function start(): Promise<void> {
  await installMockIfNeeded()
  const root = document.getElementById('root')
  if (!root) throw new Error('#root missing')
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>
  )
}

void start()
