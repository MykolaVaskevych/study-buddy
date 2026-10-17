import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

describe('LibraryScreen', () => {
  it('renders books from the mock', async () => {
    renderApp('/')
    const books = await screen.findByRole('region', { name: 'Books' })
    expect(within(books).getByRole('link', { name: 'Optical Networks' })).toBeTruthy()
    expect(within(books).getAllByText(/^\d+ cards due$/).length).toBeGreaterThan(0)
    expect(within(books).getByText(/^Exam in (8|9|10) days$/)).toBeTruthy()
    expect(within(books).getByText(/Indexing, 60 of 146 pages/)).toBeTruthy()
  })

  it('imports through library.import with the native picker', async () => {
    const { mock } = renderApp('/')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Books' })
    await user.click(screen.getByRole('button', { name: /Import PDF/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('library.import', { paths: null }))
    expect(await screen.findByRole('link', { name: 'Thermodynamics, week 3' })).toBeTruthy()
  })

  it('searches every page and links hits to the page', async () => {
    renderApp('/')
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Books' })
    await user.type(screen.getByRole('combobox', { name: 'Search your library' }), 'power budget')
    const options = await screen.findAllByRole('option')
    expect(options[0]?.textContent).toMatch(/p\. \d+/)
  })
})
