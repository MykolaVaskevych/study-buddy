import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

// Course actions do not depend on PDF rendering or its browser worker.
vi.mock('../reader/pdf/PdfViewer', () => ({ PdfViewer: () => null }))
vi.mock('../reader/pdf/usePdfDocument', () => ({ usePdfDocument: () => ({ status: 'loading' }) }))

describe('course study menu', () => {
  it('opens review with the course selected', async () => {
    const { mock } = renderApp('/book/optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const tree = await screen.findByRole('list', { name: 'Courses' })
    const [menu] = await within(tree).findAllByRole('button', { name: 'Optical Networks options' })
    if (!menu) throw new Error('missing course menu')
    await user.click(menu)
    await user.click(await screen.findByRole('menuitem', { name: 'Review this course' }))
    await screen.findByRole('heading', { name: 'Review' })
    expect((screen.getByRole('combobox', { name: 'Cards from' }) as HTMLSelectElement).value).toBe(
      'course:course-optical-networks'
    )
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cards.due', {
        docId: null,
        courseId: 'course-optical-networks',
        limit: 200
      })
    )
  })

  it('opens a cram on the first file with all course files ticked', async () => {
    const { mock } = renderApp('/book/optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await mock.invoke('courses.moveDocument', {
      docId: 'signals-systems',
      courseId: 'course-optical-networks',
      index: 0
    })
    const tree = await screen.findByRole('list', { name: 'Courses' })
    await waitFor(() =>
      expect(within(tree).getByRole('list', { name: 'Files in Optical Networks' }).children).toHaveLength(2)
    )
    const [menu] = within(tree).getAllByRole('button', { name: 'Optical Networks options' })
    if (!menu) throw new Error('missing course menu')
    await user.click(menu)
    await user.click(await screen.findByRole('menuitem', { name: 'Don’t panic for this course' }))
    const picker = await screen.findByRole('group', { name: 'What’s on the test?' })
    const boxes = await within(picker).findAllByRole<HTMLInputElement>('checkbox')
    expect(boxes).toHaveLength(2)
    expect(boxes.every((box) => box.checked)).toBe(true)
    expect(
      screen.getByRole('link', { name: 'Signals and Systems: Lecture Slides' }).getAttribute('href')
    ).toBe('/book/signals-systems')
    await user.click(screen.getByRole('button', { name: 'Start' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('cram.plan', {
        docId: 'signals-systems',
        cards: 20,
        scopes: [
          { docId: 'signals-systems', topicIds: null },
          { docId: 'optical-networks', topicIds: null }
        ]
      })
    )
  })
})
