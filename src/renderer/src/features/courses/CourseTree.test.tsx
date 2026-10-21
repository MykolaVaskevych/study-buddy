import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const calls = (invoke: { mock: { calls: unknown[][] } }, channel: string): unknown[] =>
  invoke.mock.calls.filter(([c]) => c === channel).map(([, input]) => input)

describe('CourseTree', () => {
  it('lists courses with the open file expanded, and switches files', async () => {
    renderApp('/book/optical-networks')
    const user = userEvent.setup()
    const tree = await screen.findByRole('list', { name: 'Courses' })
    const current = await within(tree).findByRole('button', { name: /Optical Networks/, current: 'page' })
    expect(current).toBeTruthy()
    // The open file shows its topics; another course is folded.
    expect(within(tree).getByRole('button', { name: 'Collapse Optical Networks' })).toBeTruthy()
    await user.click(within(tree).getByRole('button', { name: 'Expand Signals and Systems: Lecture Slides' }))
    const signals = await within(tree).findByRole('list', {
      name: 'Files in Signals and Systems: Lecture Slides'
    })
    await user.click(
      await within(signals).findByRole('button', { name: /^Signals and Systems: Lecture Slides(\s*\d+)?$/ })
    )
    await waitFor(() =>
      expect(within(tree).getByRole('button', { name: /Signals and Systems/, current: 'page' })).toBeTruthy()
    )
  })

  it('renames a file in place and moves it to another course from its menu', async () => {
    const { mock } = renderApp('/book/optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const tree = await screen.findByRole('list', { name: 'Courses' })
    await user.dblClick(
      await within(tree).findByRole('button', { name: /Optical Networks/, current: 'page' })
    )
    const field = screen.getByRole('textbox', { name: 'File name' })
    await user.clear(field)
    await user.type(field, 'Week 1 slides{Enter}')
    await waitFor(() =>
      expect(calls(invoke, 'library.rename')).toEqual([{ docId: 'optical-networks', title: 'Week 1 slides' }])
    )

    await user.click(within(tree).getAllByRole('button', { name: /options$/ })[1] as HTMLElement)
    await user.click(
      await screen.findByRole('menuitem', { name: 'Move to Signals and Systems: Lecture Slides' })
    )
    await waitFor(() =>
      expect(calls(invoke, 'courses.moveDocument')).toEqual([
        { docId: 'optical-networks', courseId: 'course-signals-systems', index: 1 }
      ])
    )
    expect(
      await within(tree).findByRole('list', { name: 'Files in Signals and Systems: Lecture Slides' })
    ).toBeTruthy()
  })

  it('renames a course with F2 and Escape cancels', async () => {
    const { mock } = renderApp('/book/optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const tree = await screen.findByRole('list', { name: 'Courses' })
    const courseRow = (): HTMLElement => within(tree).getByRole('button', { name: /^Optical Networks\s*1$/ })
    await within(tree).findByRole('list', { name: 'Files in Optical Networks' })
    courseRow().focus()
    await user.keyboard('{F2}')
    await user.keyboard('{Escape}')
    expect(calls(invoke, 'courses.rename')).toEqual([])
    courseRow().focus()
    await user.keyboard('{F2}')
    const field = screen.getByRole('textbox', { name: 'Course name' })
    await user.clear(field)
    await user.type(field, 'Optics{Enter}')
    await waitFor(() =>
      expect(calls(invoke, 'courses.rename')).toEqual([
        { courseId: 'course-optical-networks', name: 'Optics' }
      ])
    )
  })
})
