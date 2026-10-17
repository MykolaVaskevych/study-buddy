import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { setBridge } from '../../api/client'
import { createMockApi } from '../../api/mock'
import { ChatTab } from './ChatTab'

describe('ChatTab', () => {
  it('streams an answer and turns [p. N] into a jump button', async () => {
    setBridge(createMockApi())
    const onCitation = vi.fn()
    render(<ChatTab docId="optical-networks" page={12} index={null} onCitation={onCitation} />)
    await userEvent.type(screen.getByLabelText('Ask a question'), 'What limits the span?{Enter}')
    const cite = await screen.findByRole('button', { name: 'Go to page 12' }, { timeout: 3000 })
    await userEvent.click(cite)
    expect(onCitation).toHaveBeenCalledWith(12)
  })
})
