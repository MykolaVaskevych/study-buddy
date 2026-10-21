import { screen, waitFor, within } from '@testing-library/react'
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
    expect(calls(invoke, 'cram.plan')).toEqual([
      { docId: 'optical-networks', cards: 10, scopes: [{ docId: 'optical-networks', topicIds: null }] }
    ])
    expect(screen.getByText(/^\d+:\d\d left$/)).toBeTruthy()

    // Easy on every card empties the queue (nothing comes back within the session).
    while (screen.queryByRole('article', { name: /^Flashcard/ })) {
      await user.keyboard(' ')
      await screen.findByRole('article', { name: 'Flashcard, answer shown' })
      await user.keyboard('4')
    }
    await user.click(await screen.findByRole('button', { name: /^Next: 5 exam questions/ }))
    await waitFor(() =>
      expect(calls(invoke, 'cram.quiz')).toEqual([
        { scopes: [{ docId: 'optical-networks', topicIds: null }], count: 5, types: ['mcq', 'multi', 'tf'] }
      ])
    )
    expect(await screen.findByText(/Step 2 of 2/)).toBeTruthy()
  })

  it('is one click away on every book card', async () => {
    renderApp('/')
    const links = await screen.findAllByRole('link', { name: 'Don’t panic' })
    expect(links[0]?.getAttribute('href')).toMatch(/^\/book\/.+\/panic$/)
  })

  it('covers the files and chapters ticked in "What is on the test?"', async () => {
    const { mock } = renderApp('/book/optical-networks/panic')
    // Two files in one course, like weeks of a module.
    const moved = await mock.invoke('courses.moveDocument', {
      docId: 'signals-systems',
      courseId: 'course-optical-networks',
      index: 1
    })
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const picker = await screen.findByRole('list', { name: 'Files and chapters' })
    await new Promise((r) => setTimeout(r, 300))
    console.log('PICKER', picker.textContent, JSON.stringify(moved))
    await user.click(await within(picker).findByRole('checkbox', { name: /Signals and Systems/ }))
    // Only part of the first file: open its chapters and untick the first one.
    await user.click(within(picker).getByRole('button', { name: 'Choose chapters of Optical Networks' }))
    const chapters = await within(picker).findByRole('list', { name: 'Chapters of Optical Networks' })
    const [firstChapter] = within(chapters).getAllByRole('checkbox')
    await user.click(firstChapter as HTMLElement)
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() => expect(calls(invoke, 'cram.plan')).toHaveLength(1))
    const [input] = calls(invoke, 'cram.plan') as { scopes: { docId: string; topicIds: string[] | null }[] }[]
    expect(input?.scopes.map((s) => s.docId)).toEqual(['optical-networks', 'signals-systems'])
    expect(input?.scopes[0]?.topicIds?.length).toBeGreaterThan(0)
    expect(input?.scopes[1]?.topicIds).toBeNull()
  })
})
