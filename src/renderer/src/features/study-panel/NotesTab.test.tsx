import { screen } from '@testing-library/react'
import { vi } from 'vitest'
import { renderWithProviders } from '../../test/render'
import { NotesTab } from './NotesTab'

const index = { state: 'running' as const, indexedPages: 60, totalPages: 146 }

describe('NotesTab', () => {
  it('renders formulas with KaTeX and the symbol table', async () => {
    // Page 40 of the mock "Optical Networks" deck is the power-budget slide (indexed).
    const { container } = renderWithProviders(
      <NotesTab docId="optical-networks" page={40} index={index} onCitation={vi.fn()} />
    )
    expect(await screen.findByText('Formulas')).toBeTruthy()
    expect(container.querySelector('.katex')).not.toBeNull()
    expect(screen.getByText('received power')).toBeTruthy()
    expect(screen.getByText('Exam trap')).toBeTruthy()
  })

  it('shows the indexing state for pages not indexed yet', async () => {
    renderWithProviders(<NotesTab docId="optical-networks" page={120} index={index} onCitation={vi.fn()} />)
    expect(await screen.findByRole('heading', { name: 'Indexing…' })).toBeTruthy()
    expect(screen.getByText('60 of 146 pages indexed')).toBeTruthy()
  })
})
