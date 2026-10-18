import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../test/render'

describe('Your exam panel', () => {
  it('asks for the exam before preparing and saves the answers', async () => {
    const { mock } = renderApp('/book/optical-networks/overview')
    expect(await screen.findByText('Your exam')).toBeTruthy()
    expect(screen.getByText('Not set yet')).toBeTruthy()
    const invoke = vi.spyOn(mock, 'invoke')

    await userEvent.click(screen.getByRole('button', { name: /Prepare everything/ }))
    expect(await screen.findByText('First: your exam')).toBeTruthy()

    // Only multiple choice, no formulas.
    await userEvent.click(screen.getByRole('button', { name: 'Written answers' }))
    await userEvent.click(screen.getByRole('button', { name: 'Calculations' }))
    await userEvent.click(screen.getByLabelText(/Not needed/))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(invoke).toHaveBeenCalledWith('exam.saveProfile', {
      docId: 'optical-networks',
      formats: { mcq: 1, written: 0, numeric: 0 },
      formulas: 'none',
      formulaSheet: false
    })
    expect(await screen.findByText('Set by you')).toBeTruthy()
  })
})
