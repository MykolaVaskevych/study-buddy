import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const calls = (invoke: { mock: { calls: unknown[][] } }, channel: string): unknown[] =>
  invoke.mock.calls.filter(([c]) => c === channel).map(([, input]) => input)

describe('CramScreen', () => {
  it('runs the picked cards, then exam-style questions in the exam types', async () => {
    const { mock } = renderApp('/book/optical-networks/panic')
    await mock.invoke('exam.saveProfile', {
      docId: 'optical-networks',
      formats: { mcq: 1, written: 0, numeric: 0 },
      formulas: 'none',
      formulaSheet: false
    })
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: /Quick/ }))
    await user.click(screen.getByRole('button', { name: 'Start' }))
    expect(await screen.findByRole('article', { name: 'Flashcard' })).toBeTruthy()
    expect(calls(invoke, 'cram.plan')).toEqual([{ docId: 'optical-networks', cards: 10 }])
    expect(screen.getByText(/^\d+:\d\d left$/)).toBeTruthy()

    // Easy on every card empties the queue (nothing comes back within the session).
    while (screen.queryByRole('article', { name: /^Flashcard/ })) {
      await user.keyboard(' ')
      await screen.findByRole('article', { name: 'Flashcard, answer shown' })
      await user.keyboard('4')
    }
    await user.click(await screen.findByRole('button', { name: /^Next: 5 exam questions/ }))
    await waitFor(() =>
      expect(calls(invoke, 'quiz.create')).toEqual([
        {
          scope: { kind: 'document', docId: 'optical-networks' },
          mode: 'topic',
          count: 5,
          types: ['mcq', 'multi', 'tf'],
          timeLimit: null
        }
      ])
    )
    expect(await screen.findByText(/Step 2 of 2/)).toBeTruthy()
  })

  it('is one click away on every book card', async () => {
    renderApp('/')
    const links = await screen.findAllByRole('link', { name: 'Don’t panic' })
    expect(links[0]?.getAttribute('href')).toMatch(/^\/book\/.+\/panic$/)
  })
})
