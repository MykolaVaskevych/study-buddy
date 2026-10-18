import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../test/render'

describe('OverviewScreen', () => {
  it('shows what the AI prepared, prepares everything and resets with confirmation', async () => {
    const { mock } = renderApp('/book/optical-networks/overview')
    expect(await screen.findByText('What the AI has prepared')).toBeTruthy()
    expect(screen.getByText('Read every page')).toBeTruthy()
    expect(screen.getByText('Essentials flashcards')).toBeTruthy()

    const invoke = vi.spyOn(mock, 'invoke')
    await userEvent.click(screen.getByRole('button', { name: /Prepare everything/ }))
    expect(invoke).toHaveBeenCalledWith('library.prepare', { docId: 'optical-networks' })

    await userEvent.click(screen.getByRole('button', { name: 'Reset book progress' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText(/Everything the AI made/)).toBeTruthy()
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reset' }))
    expect(invoke).toHaveBeenCalledWith('progress.reset', { docId: 'optical-networks', topicId: null })
  })
})
