import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const topic = encodeURIComponent('optical-networks:Attenuation and the power budget')

describe('QuizScreen', () => {
  it('exam mode hides feedback until the quiz is handed in', async () => {
    const { mock } = renderApp(`/book/optical-networks/quiz?topic=${topic}`)
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    expect(((await screen.findByRole('combobox', { name: 'Topic' })) as HTMLSelectElement).value).toBe(
      'optical-networks:Attenuation and the power budget'
    )
    await user.click(screen.getByRole('radio', { name: '5' }))
    await user.click(screen.getByRole('radio', { name: 'Exam: at the end' }))
    await user.click(screen.getByRole('button', { name: /Start the 8-minute exam/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'quiz.create',
        expect.objectContaining({ mode: 'mock', count: 5, timeLimit: 8, types: null })
      )
    )

    // Question 1: answer and move on. Nothing is marked or revealed.
    expect(await screen.findByText('Why is it wrong to add two dBm values?')).toBeTruthy()
    expect(screen.getByRole('timer').textContent).toMatch(/^\d+:\d\d$/)
    await user.keyboard('1')
    await user.keyboard('{Enter}')
    expect(await screen.findByText('Question 2')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Feedback' })).toBeNull()
    expect(invoke.mock.calls.some(([channel]) => channel === 'quiz.answer')).toBe(false)

    // Going back shows the saved answer, still unmarked.
    await user.click(screen.getByRole('button', { name: 'Question 1, answered' }))
    expect(
      (screen.getAllByRole('radio', { name: /dBm is an absolute power level/ })[0] as HTMLInputElement)
        .checked
    ).toBe(true)
    expect(screen.queryByText('Correct')).toBeNull()

    // Hand in with unanswered questions: confirm, then everything is marked.
    await user.click(screen.getAllByRole('button', { name: 'Hand in' })[0]!)
    const confirm = await screen.findByRole('dialog', { name: '4 questions have no answer' })
    await user.click(within(confirm).getByRole('button', { name: 'Hand in' }))

    expect(await screen.findByRole('img', { name: '1 out of 5' })).toBeTruthy()
    expect(invoke.mock.calls.filter(([channel]) => channel === 'quiz.answer')).toHaveLength(1)
    expect(screen.getByText(/4 questions were left unanswered/)).toBeTruthy()
    expect(screen.getByRole('button', { name: /Retry mistakes/ })).toBeTruthy()
    const pages = screen.getByRole('heading', { name: 'Review these pages' }).parentElement
    expect(within(pages!).getAllByRole('link')[0]?.getAttribute('href')).toMatch(
      /^\/book\/optical-networks\?page=\d+$/
    )
  })

  it('instant mode marks each answer and lists past quizzes', async () => {
    renderApp(`/book/optical-networks/quiz?topic=${topic}`)
    const user = userEvent.setup()
    await screen.findByRole('combobox', { name: 'Topic' })
    await user.click(screen.getByRole('radio', { name: '5' }))
    await user.click(screen.getByRole('button', { name: /Start 5 questions/ }))
    await screen.findByText('Why is it wrong to add two dBm values?')
    await user.keyboard('1{Enter}')
    expect(await screen.findByRole('region', { name: 'Feedback' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Finish now' }))
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Hand in' }))
    await screen.findByRole('img', { name: '1 out of 5' })
    await user.click(screen.getByRole('button', { name: 'New quiz' }))
    const history = await screen.findByRole('region', { name: 'Past quizzes' })
    expect(await within(history).findByText('1/5')).toBeTruthy()
  })
})
