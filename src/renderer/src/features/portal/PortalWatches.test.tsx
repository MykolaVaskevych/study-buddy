import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderApp } from '../../test/render'
import { useToasts } from '../../app/toasts'

const courseId = 'course-optical-networks'
const url = 'https://learn.ul.ie/course'

beforeEach(() => useToasts.setState({ toasts: [] }))

describe('watched portal pages', () => {
  it('requires a page and a course, toggles a watch and removes it from home', async () => {
    const { mock } = renderApp('/portal')
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: 'Watch this page' })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole('textbox', { name: 'Portal address' }), `${url}{Enter}`)
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.selectOptions(screen.getByRole('combobox', { name: /Files go to/ }), courseId)
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)
    const stop = await screen.findByRole('button', { name: 'Stop watching this page' })
    expect(stop.getAttribute('aria-pressed')).toBe('true')
    await user.click(stop)
    await user.click(await screen.findByRole('button', { name: 'Watch this page' }))
    await screen.findByRole('button', { name: 'Stop watching this page' })
    await user.click(screen.getByRole('button', { name: 'Portal home' }))
    const list = await screen.findByRole('list', { name: 'Watched pages' })
    expect(within(list).getByText('Awaiting first check', { exact: false })).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: `Stop watching ${url}` }))
    await waitFor(() => expect(within(list).queryAllByRole('listitem')).toHaveLength(0))
    expect(await mock.invoke('portal.watches', {})).toEqual({ ok: true, data: [] })
  })

  it('announces findings away from the portal, opens their page and keeps findings on home', async () => {
    const { mock } = renderApp('/settings')
    const user = userEvent.setup()
    await screen.findByRole('heading', { name: 'Settings' })
    const response = await mock.invoke('portal.watch', { courseId, url })
    if (!response.ok) throw new Error('could not create watch')
    const invoke = vi.spyOn(mock, 'invoke')
    act(() =>
      mock.emit('portal.newFiles', {
        watchId: response.data.id,
        courseId,
        url,
        title: 'Lectures',
        items: [{ label: 'Week 2.pdf', href: `${url}/week2.pdf` }]
      })
    )
    expect(await screen.findByText('1 new file in Optical Networks')).toBeTruthy()
    await user.click(screen.getByRole('link', { name: 'Open page' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('portal.navigate', { url }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('portal.setCourse', { courseId }))
    await screen.findByRole('button', { name: 'Stop watching this page' })
    await user.click(screen.getByRole('button', { name: 'Portal home' }))
    const list = await screen.findByRole('list', { name: 'Watched pages' })
    expect(within(list).getByText('Week 2.pdf')).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: url }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Portal home' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Portal home' }))
    act(() =>
      mock.emit('portal.newFiles', {
        watchId: response.data.id,
        courseId,
        url,
        title: 'Lectures',
        items: [
          { label: 'Week 3.pdf', href: `${url}/week3.pdf` },
          { label: 'Week 4.pdf', href: `${url}/week4.pdf` }
        ]
      })
    )
    await screen.findByText('2 new files in Optical Networks')
    await user.click(screen.getByRole('link', { name: 'Open page' }))
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Portal home' })).toBeNull())
  })
})
