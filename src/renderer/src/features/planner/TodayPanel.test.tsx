import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { solvePlan } from '@shared/planner'
import { useLibrary } from '../../api/hooks'
import { Providers } from '../../app/providers'
import { createQueryClient } from '../../app/queryClient'
import { useUiStore } from '../../app/uiStore'
import { installMock, renderApp } from '../../test/render'
import { TodayPanel } from './TodayPanel'

function Library(): React.JSX.Element | null {
  const library = useLibrary()
  const [now] = useState(() => new Date())
  return library.data ? <TodayPanel docs={library.data} now={now} /> : null
}

function Location(): React.JSX.Element {
  const location = useLocation()
  return <p aria-label="Location">{`${location.pathname}${location.search}`}</p>
}

function renderToday(): void {
  installMock()
  render(
    <Providers client={createQueryClient({ retry: false })}>
      <MemoryRouter initialEntries={['/']}>
        <Routes>
          <Route path="/" element={<Library />} />
          <Route path="*" element={<Location />} />
        </Routes>
      </MemoryRouter>
    </Providers>
  )
}

const signals = 'Signals and Systems: Lecture Slides'

describe('TodayPanel', () => {
  it('lists today’s sessions of planned books, and Start opens the book at the topic', async () => {
    renderToday()
    const user = userEvent.setup()
    const today = await screen.findByRole('region', { name: 'Today' })
    const book = within(today).getByRole('article', { name: signals })
    expect(within(book).getByText('Exam in 3 days')).toBeTruthy()
    const sessions = within(book).getByRole('list', { name: `Today's sessions for ${signals}` })
    expect(within(sessions).getAllByRole('listitem').length).toBeGreaterThan(0)
    // Only books with a saved plan appear.
    expect(within(today).queryByRole('article', { name: 'Optical Networks' })).toBeNull()

    const learn = within(book).getAllByRole('button', { name: /^Start: Learn/ })[0]
    expect(learn).toBeTruthy()
    const label = learn?.getAttribute('aria-label') ?? ''
    await user.click(learn as HTMLElement)
    const location = await screen.findByLabelText('Location')
    // The first learn session's topic starts on its first page in the mock course map.
    const pages: Record<string, number> = {
      'Signals and their properties': 3,
      'Convolution and LTI systems': 61,
      'Fourier transform and sampling': 131
    }
    const topic = Object.keys(pages).find((t) => label.includes(t)) ?? ''
    expect(location.textContent).toBe(`/book/signals-systems?page=${pages[topic] ?? 0}`)
  })

  it('a page check opens the book with the Test me tab', async () => {
    renderToday()
    const user = userEvent.setup()
    useUiStore.getState().setStudyTab('notes')
    const today = await screen.findByRole('region', { name: 'Today' })
    const check = within(today).getAllByRole('button', { name: /^Start: Check/ })[0]
    await user.click(check as HTMLElement)
    await screen.findByLabelText('Location')
    expect(useUiStore.getState().studyTab).toBe('test')
  })

  it('sits at the top of the library screen', async () => {
    renderApp('/')
    const today = await screen.findByRole('region', { name: 'Today' })
    expect(within(today).getByRole('article', { name: signals })).toBeTruthy()
    expect(within(today).getByRole('link', { name: signals }).getAttribute('href')).toBe(
      '/book/signals-systems/plan'
    )
  })
})

describe('mock planner data', () => {
  it('plan.topics returns leaf topics with prerequisites, and the OSNR derivation is skipped when time is short', async () => {
    const mock = installMock()
    const res = await mock.invoke('plan.topics', { docId: 'optical-networks' })
    if (!res.ok) throw new Error(res.error.message)
    const topics = res.data
    const osnr = topics.find((t) => t.title === 'OSNR chain derivation')
    expect(osnr).toMatchObject({ fullMinutes: 240, examWeight: 0.06 })
    expect(osnr?.prerequisites).toEqual(['optical-networks:Erbium-doped fibre amplifiers'])
    expect(topics.some((t) => t.title === 'Optical amplifiers and noise')).toBe(false)
    const plan = solvePlan(topics, {
      examDate: null,
      totalHours: 8,
      hoursPerDay: null,
      targetScore: 0.75,
      mode: 'max_score',
      format: 'mixed',
      overrides: []
    })
    const item = plan.items.find((i) => i.topicId === osnr?.id)
    expect(item?.level).toBe('skip')
    expect(plan.feasible).toBe(false)
    expect(plan.notes.some((n) => /About .+ would get there/.test(n))).toBe(true)
  })

  it('plan.save solves with the real planner and plan.today returns today’s day', async () => {
    const mock = installMock()
    const saved = await mock.invoke('plan.save', {
      docId: 'optical-networks',
      input: {
        examDate: null,
        totalHours: 6,
        hoursPerDay: null,
        targetScore: 0.6,
        mode: 'max_score',
        format: 'mixed',
        overrides: [],
        reserveFraction: 0.3
      }
    })
    if (!saved.ok) throw new Error(saved.error.message)
    expect(saved.data.result.reserveMinutes).toBe(108)
    const today = await mock.invoke('plan.today', { docId: 'optical-networks' })
    if (!today.ok) throw new Error(today.error.message)
    expect(today.data?.date).toBe(saved.data.schedule.days[0]?.date)
  })
})
