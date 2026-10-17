import { render } from '@testing-library/react'
import type { RenderResult } from '@testing-library/react'
import type { ReactNode } from 'react'
import { RouterProvider } from 'react-router'
import { setBridge } from '../api/client'
import { createMockApi } from '../api/mock'
import type { MockApi } from '../api/mock'
import { Providers } from '../app/providers'
import { createQueryClient } from '../app/queryClient'
import { createTestRouter } from '../app/router'
import { MemoryRouter } from 'react-router'

/** Installs a fresh mock bridge (no latency, no background timers). */
export function installMock(): MockApi {
  const mock = createMockApi({ latency: [0, 0], simulate: false })
  setBridge(mock)
  return mock
}

/** Renders the whole app (layout + routes) at a URL against the mock. */
export function renderApp(url = '/'): RenderResult & { mock: MockApi } {
  const mock = installMock()
  const client = createQueryClient({ retry: false })
  const router = createTestRouter([url])
  return Object.assign(
    render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>
    ),
    { mock }
  )
}

/** Renders one component with the query client and a router context. */
export function renderWithProviders(ui: ReactNode): RenderResult & { mock: MockApi } {
  const mock = installMock()
  const client = createQueryClient({ retry: false })
  return Object.assign(
    render(
      <Providers client={client}>
        <MemoryRouter>{ui}</MemoryRouter>
      </Providers>
    ),
    { mock }
  )
}
