import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const calls = (invoke: { mock: { calls: unknown[][] } }, channel: string): unknown[] =>
  invoke.mock.calls.filter(([c]) => c === channel).map(([, input]) => input)

describe('PortalScreen', () => {
  it('opens a portal from the start panel and lays the browser over the page area', async () => {
    const { mock } = renderApp('/portal?course=course-optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Brightspace (UL)' }))
    await waitFor(() => expect(calls(invoke, 'portal.navigate')).toEqual([{ url: 'learn.ul.ie' }]))
    await waitFor(() => expect(calls(invoke, 'portal.open')).toHaveLength(1))
    expect(calls(invoke, 'portal.open')[0]).toMatchObject({ courseId: 'course-optical-networks' })
    expect((screen.getByRole('textbox', { name: 'Portal address' }) as HTMLInputElement).value).toBe(
      'https://learn.ul.ie'
    )
  })

  it('types an address and picks the course downloads go into', async () => {
    const { mock } = renderApp('/portal')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await user.type(await screen.findByRole('textbox', { name: 'Portal address' }), 'sulis.ul.ie{Enter}')
    await waitFor(() => expect(calls(invoke, 'portal.navigate')).toEqual([{ url: 'sulis.ul.ie' }]))
    const select = screen.getByRole('combobox', { name: /Files go to/ })
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1))
    await user.selectOptions(select, 'course-optical-networks')
    await waitFor(() =>
      expect(calls(invoke, 'portal.setCourse')).toEqual([{ courseId: 'course-optical-networks' }])
    )
    expect((select as HTMLSelectElement).value).toBe('course-optical-networks')
  })
})
