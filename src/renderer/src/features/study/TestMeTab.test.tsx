import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { TestMeTab } from './TestMeTab'

const index = { state: 'running' as const, indexedPages: 60, totalPages: 146 }

// Page 40 of the mock "Optical Networks" deck is the power-budget slide: its page check is
// an mcq (correct: option 1), a numeric question (−16 dBm) and a true/false (true).
function renderPage40(onCitation = vi.fn()) {
  const view = renderWithProviders(
    <TestMeTab docId="optical-networks" page={40} index={index} onCitation={onCitation} />
  )
  return { ...view, onCitation, user: userEvent.setup() }
}

describe('TestMeTab', () => {
  it('runs a page check: answer an mcq, see feedback, go on, get a summary', async () => {
    const { user, onCitation } = renderPage40()
    await user.click(await screen.findByRole('button', { name: /Test me on page 40/ }))

    // Question 1: pick with the number key, check with Enter.
    expect(await screen.findByText('Why is it wrong to add two dBm values?')).toBeTruthy()
    await user.keyboard('1')
    expect((screen.getAllByRole('radio')[0] as HTMLInputElement).checked).toBe(true)
    await user.keyboard('{Enter}')

    const feedback = await screen.findByRole('region', { name: 'Feedback' })
    expect(within(feedback).getByText('Correct')).toBeTruthy()
    expect(within(feedback).getByText('Each option')).toBeTruthy()
    expect(screen.getByText('Correct.', { selector: '[aria-live]' })).toBeTruthy()
    // Focus moved to the action button, so Enter continues.
    const next = screen.getByRole('button', { name: /Next question/ })
    await waitFor(() => expect(document.activeElement).toBe(next))
    // Citations in the explanation jump the reader.
    await user.click(within(feedback).getByRole('button', { name: 'Go to page 40' }))
    expect(onCitation).toHaveBeenCalledWith(40)
    await user.click(next)

    // Question 2 (numeric): answer wrong to see the correct answer.
    await user.type(await screen.findByRole('textbox', { name: 'Value' }), '-15')
    await user.type(screen.getByRole('textbox', { name: 'Unit' }), 'dBm{Enter}')
    expect(await screen.findByText('Not quite', { selector: 'p' })).toBeTruthy()
    expect(screen.getByText(/-16 dBm/)).toBeTruthy()
    await user.click(screen.getByRole('button', { name: /Next question/ }))

    // Question 3 (true/false).
    expect(await screen.findByText(/system margin of 3 to 6 dB/)).toBeTruthy()
    await user.keyboard('1')
    await user.keyboard('{Enter}')
    await user.click(await screen.findByRole('button', { name: /See my score/ }))

    expect(await screen.findByRole('img', { name: '2 out of 3' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Page 40/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /New questions/ })).toBeTruthy()
  })

  it('sends numeric answers as value plus unit', async () => {
    const { user, mock } = renderPage40()
    const invoke = vi.spyOn(mock, 'invoke')
    await user.click(await screen.findByRole('button', { name: /Test me on page 40/ }))
    await screen.findByText('Why is it wrong to add two dBm values?')
    await user.keyboard('2{Enter}')
    await user.click(await screen.findByRole('button', { name: /Next question/ }))

    await user.type(await screen.findByRole('textbox', { name: 'Value' }), '−16')
    await user.type(screen.getByRole('textbox', { name: 'Unit' }), 'dBm')
    await user.click(screen.getByRole('button', { name: /Check/ }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'quiz.answer',
        expect.objectContaining({ response: { type: 'numeric', value: -16, unit: 'dBm' } })
      )
    )
    expect(await screen.findByText('Correct', { selector: 'p' })).toBeTruthy()
  })

  it('keeps number keys for the answer while a question is open', async () => {
    const { user } = renderPage40()
    await user.click(await screen.findByRole('button', { name: /Test me on page 40/ }))
    await screen.findByText('Why is it wrong to add two dBm values?')
    const keydown = new KeyboardEvent('keydown', { key: '7', bubbles: true, cancelable: true })
    window.dispatchEvent(keydown)
    expect(keydown.defaultPrevented).toBe(true)
  })
})
