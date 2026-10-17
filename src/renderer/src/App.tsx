import { useState } from 'react'
import { RouterProvider } from 'react-router'
import { Providers } from './app/providers'
import { createQueryClient } from './app/queryClient'
import { createAppRouter } from './app/router'

export function App(): React.JSX.Element {
  const [client] = useState(() => createQueryClient())
  const [router] = useState(() => createAppRouter())
  return (
    <Providers client={client}>
      <RouterProvider router={router} />
    </Providers>
  )
}
