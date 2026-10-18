import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClientProvider } from '@tanstack/react-query'
import { setBridge } from '../../api/client'
import { createMockApi } from '../../api/mock'
import { createQueryClient } from '../../app/queryClient'
import { BookmarkButton, BookmarkList } from './Bookmarks'

describe('bookmarks', () => {
  it('toggles a bookmark and lists it for jumping', async () => {
    setBridge(createMockApi())
    const onJump = vi.fn()
    render(
      <QueryClientProvider client={createQueryClient({ retry: false })}>
        <BookmarkButton docId="optical-networks" page={12} />
        <BookmarkList docId="optical-networks" page={1} onJump={onJump} />
      </QueryClientProvider>
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Bookmark page 12' }))
    const item = await screen.findByRole('button', { name: /p\. 12/ })
    await userEvent.click(item)
    expect(onJump).toHaveBeenCalledWith(12)
    expect(await screen.findByRole('button', { name: 'Remove bookmark on page 12' })).toBeTruthy()
  })
})
