import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { CardsTab } from './CardsTab'

const index = { state: 'running' as const, indexedPages: 60, totalPages: 146 }

describe('CardsTab', () => {
  it('shows the page’s cards with cloze gaps and reveals them', async () => {
    const { container } = renderWithProviders(
      <CardsTab docId="optical-networks" page={32} index={index} onCitation={vi.fn()} />
    )
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Cards for page 32' })
    expect(await within(list).findByText('1 card')).toBeTruthy()
    expect(container.querySelectorAll('[data-cloze="gap"]')).toHaveLength(2)
    await user.click(within(list).getByRole('button', { name: 'Show answer' }))
    expect(container.querySelectorAll('mark[data-cloze="answer"]')).toHaveLength(2)
  })

  it('writes essentials for the topic and follows the job to the end', async () => {
    const { mock } = renderWithProviders(
      <CardsTab docId="optical-networks" page={32} index={index} onCitation={vi.fn()} />
    )
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Cards for page 32' })
    await user.click(screen.getByRole('radio', { name: 'This topic' }))
    const list = await screen.findByRole('region', { name: 'Cards for Attenuation and the power budget' })
    const before = (await within(list).findAllByRole('listitem')).length

    await user.click(screen.getByRole('button', { name: /Essentials/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cards.generate', {
        scope: {
          kind: 'topic',
          docId: 'optical-networks',
          topicId: 'optical-networks:Attenuation and the power budget'
        },
        essentialsOnly: true,
        count: null
      })
    )
    expect(await screen.findByText('New cards added below.')).toBeTruthy()
    await waitFor(() => expect(within(list).getAllByRole('listitem').length).toBeGreaterThan(before))
    expect(within(list).getByText('What is receiver sensitivity?')).toBeTruthy()
  })

  it('suspends a card and can restore it', async () => {
    const { mock } = renderWithProviders(
      <CardsTab docId="optical-networks" page={32} index={index} onCitation={vi.fn()} />
    )
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const list = await screen.findByRole('region', { name: 'Cards for page 32' })
    await user.click(await within(list).findByRole('button', { name: 'Suspend card' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cards.setStatus', expect.objectContaining({ status: 'suspended' }))
    )
    expect(await within(list).findByText('Suspended')).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: 'Restore card' }))
    await waitFor(() => expect(within(list).queryByText('Suspended')).toBeNull())
  })
})
