import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../test/render'

describe('StudyBookScreen', () => {
  it('shows written chapters with exercises and writes the missing ones', async () => {
    const { mock } = renderApp('/book/optical-networks/studybook')
    expect(await screen.findByRole('heading', { name: 'Study book' })).toBeTruthy()
    expect(await screen.findByText('The idea')).toBeTruthy()
    await userEvent.click(screen.getAllByRole('button', { name: 'Show answer' })[0]!)
    expect(screen.queryAllByRole('button', { name: 'Show answer' })).toHaveLength(0)
    const invoke = vi.spyOn(mock, 'invoke')
    await userEvent.click(screen.getByRole('button', { name: /Write all chapters/ }))
    expect(invoke).toHaveBeenCalledWith('lessons.generate', { docId: 'optical-networks', topicId: null })
  })
})
