import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'
import { portalAddress } from './PortalHome'

const calls = (invoke: { mock: { calls: unknown[][] } }, channel: string): unknown[] =>
  invoke.mock.calls.filter(([c]) => c === channel).map(([, input]) => input)

describe('portalAddress', () => {
  it('accepts what students type and rejects the rest', () => {
    expect(portalAddress('learn.ul.ie')).toBe('https://learn.ul.ie/')
    expect(portalAddress('http://localhost:8080')).toBe('http://localhost:8080/')
    expect(portalAddress('blackboard')).toBeNull()
    expect(portalAddress('ftp://x.org')).toBeNull()
  })
})

describe('PortalScreen', () => {
  it('a suggestion only adds a portal; opening it shows the page, and Home comes back', async () => {
    const { mock } = renderApp('/portal?course=course-optical-networks')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add Brightspace (UL)' }))
    expect(calls(invoke, 'portal.navigate')).toEqual([])
    await waitFor(() =>
      expect(calls(invoke, 'settings.update')).toEqual([
        { portals: [{ name: 'Brightspace (UL)', url: 'https://learn.ul.ie/' }] }
      ])
    )

    const list = await screen.findByRole('list', { name: 'Your portals' })
    await user.click(within(list).getByRole('button', { name: /^Brightspace \(UL\)/ }))
    await waitFor(() => expect(calls(invoke, 'portal.navigate')).toEqual([{ url: 'https://learn.ul.ie/' }]))
    await waitFor(() => expect(calls(invoke, 'portal.open')).toHaveLength(1))
    expect(calls(invoke, 'portal.open')[0]).toMatchObject({ courseId: 'course-optical-networks' })
    expect(screen.queryByRole('region', { name: 'Portal home' })).toBeNull()

    await user.click(screen.getByRole('button', { name: 'Portal home' }))
    await waitFor(() => expect(calls(invoke, 'portal.close')).toHaveLength(1))
    expect(await screen.findByRole('button', { name: /^Continue:/ })).toBeTruthy()
  })

  it('adds and removes portals, and types an address', async () => {
    const { mock } = renderApp('/portal')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Add portal' }))
    const form = screen.getByRole('form', { name: 'Add a portal' })
    await user.type(within(form).getByRole('textbox', { name: 'Address' }), 'moodle.example.edu')
    await user.click(within(form).getByRole('button', { name: 'Add' }))
    const list = await screen.findByRole('list', { name: 'Your portals' })
    expect(within(list).getByRole('button', { name: /^moodle\.example\.edu/ })).toBeTruthy()
    await user.click(within(list).getByRole('button', { name: 'Remove moodle.example.edu' }))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Your portals' })).toBeNull())

    await user.type(screen.getByRole('textbox', { name: 'Portal address' }), 'sulis.ul.ie{Enter}')
    await waitFor(() => expect(calls(invoke, 'portal.navigate')).toEqual([{ url: 'sulis.ul.ie' }]))
    const select = screen.getByRole('combobox', { name: /Files go to/ })
    await waitFor(() => expect(select.querySelectorAll('option').length).toBeGreaterThan(1))
    await user.selectOptions(select, 'course-optical-networks')
    await waitFor(() =>
      expect(calls(invoke, 'portal.setCourse')).toEqual([{ courseId: 'course-optical-networks' }])
    )
  })

  it('starts Get files with AI on an open page and shows what it did', async () => {
    const { mock } = renderApp('/portal')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    const button = await screen.findByRole('button', { name: /Get files with AI/ })
    expect((button as HTMLButtonElement).disabled).toBe(true)
    await user.type(screen.getByRole('textbox', { name: 'Portal address' }), 'learn.ul.ie{Enter}')
    await waitFor(() => expect((button as HTMLButtonElement).disabled).toBe(false))
    await user.click(button)
    await waitFor(() => expect(calls(invoke, 'portal.agentStart')).toEqual([{ goal: null }]))
    const panel = await screen.findByRole('region', { name: 'Get files with AI' })
    expect(within(panel).getByText('Nothing downloaded.')).toBeTruthy()
    await user.click(within(panel).getByRole('button', { name: 'Close' }))
    expect(screen.queryByRole('region', { name: 'Get files with AI' })).toBeNull()
  })
})
