import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { formatPercent, solvePlan } from '@shared/planner'
import type { PlanInput, PlanTopic } from '@shared/planner'
import type { MockApi } from '../../api/mock'
import { renderApp } from '../../test/render'
import { localDay, toLocalDay } from './dates'
import { parseDuration } from './preview'

const docId = 'optical-networks'
const url = `/book/${docId}/plan`

async function data<T>(
  promise: Promise<{ ok: true; data: T } | { ok: false; error: { message: string } }>
): Promise<T> {
  const res = await promise
  if (!res.ok) throw new Error(res.error.message)
  return res.data
}

/** What the screen should show for an input, computed straight from the solver. */
async function expectedScore(mock: MockApi, over: Partial<PlanInput>): Promise<string> {
  const topics: PlanTopic[] = await data(mock.invoke('plan.topics', { docId }))
  const doc = await data(mock.invoke('library.get', { docId }))
  const input: PlanInput = {
    examDate: toLocalDay(doc.examDate),
    totalHours: null,
    hoursPerDay: 2,
    targetScore: 0.7,
    mode: 'max_score',
    format: 'mixed',
    overrides: [],
    ...over
  }
  return formatPercent(solvePlan(topics, input, { today: localDay(new Date()) }).expectedScore)
}

/** The score as screen readers get it ("…: expected 84 %"). */
const announcedScore = (): string => {
  const text = screen.getByText(/^: expected \d+ %$/).textContent ?? ''
  return text.replace(': expected ', '')
}

const slider = (name: string): HTMLInputElement => screen.getByRole('slider', { name }) as HTMLInputElement

describe('PlannerScreen', () => {
  it('re-solves when the hours change and updates the expected score', async () => {
    const { mock } = renderApp(url)
    await screen.findByRole('region', { name: 'Expected score' })
    expect(announcedScore()).toBe(await expectedScore(mock, {}))

    fireEvent.change(slider('Hours per day'), { target: { value: '0.5' } })
    const lower = await expectedScore(mock, { hoursPerDay: 0.5 })
    await waitFor(() => expect(announcedScore()).toBe(lower))
    expect(Number.parseInt(lower)).toBeLessThan(Number.parseInt(await expectedScore(mock, {})))
    expect(slider('Hours per day').getAttribute('aria-valuetext')).toBe('30 m a day')
  })

  it('skips the long, hard, low-weight OSNR derivation and says why', async () => {
    renderApp(url)
    const skipped = await screen.findByRole('region', { name: 'Skipped' })
    const row = within(skipped).getByText('OSNR chain derivation').closest('tr')
    expect(row).not.toBeNull()
    expect(within(row as HTMLElement).getByText(/Skipped: ~4 h for ~6 % of marks/)).toBeTruthy()
  })

  it('pinning a topic to skip moves it to the skipped section with the reason "You set this"', async () => {
    renderApp(url)
    const user = userEvent.setup()
    const level = await screen.findByRole('combobox', { name: 'Level for Attenuation and the power budget' })
    await user.selectOptions(level, 'skip')

    const skipped = await screen.findByRole('region', { name: 'Skipped' })
    await waitFor(() => expect(within(skipped).getByText('Attenuation and the power budget')).toBeTruthy())
    const row = within(skipped).getByText('Attenuation and the power budget').closest('tr') as HTMLElement
    expect(within(row).getByText('You set this')).toBeTruthy()
    // Keyboard users keep their place: the moved row's level control has the focus.
    await waitFor(() =>
      expect(document.activeElement).toBe(
        within(row).getByRole('combobox', { name: 'Level for Attenuation and the power budget' })
      )
    )
    expect(screen.getByText('Not saved yet')).toBeTruthy()
  })

  it('marks edits to a saved plan as unsaved and can discard them', async () => {
    renderApp('/book/signals-systems/plan')
    const user = userEvent.setup()
    expect(await screen.findByText('Saved')).toBeTruthy()
    fireEvent.change(slider('Target score'), { target: { value: '85' } })
    expect(await screen.findByText('Unsaved changes')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Discard' }))
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect(slider('Target score').value).toBe('70')
  })

  it('the infeasible note’s "Use …" button sets total hours and makes the plan feasible', async () => {
    renderApp(url)
    const user = userEvent.setup()
    await screen.findByRole('region', { name: 'Expected score' })
    await user.click(screen.getByRole('radio', { name: 'In total' }))
    fireEvent.change(slider('Total hours'), { target: { value: '8' } })
    fireEvent.change(slider('Target score'), { target: { value: '75' } })

    expect(await screen.findByText('Below your 75 % target')).toBeTruthy()
    expect(
      screen.getByText(/Target 75 % not reachable in 8 h; best is ~\d+ %\. About .+ would get there\./)
    ).toBeTruthy()
    const use = screen.getByRole('button', { name: /^Use \d+ h/ })
    const minutes = parseDuration(use.textContent?.replace('Use ', '') ?? '')
    expect(minutes).not.toBeNull()

    await user.click(use)
    expect(Number(slider('Total hours').value)).toBe((minutes ?? 0) / 60)
    expect(await screen.findByText('Reaches your 75 % target')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Use \d+ h/ })).toBeNull()
  })

  it('saves the input the student sees with plan.save', async () => {
    const { mock } = renderApp(url)
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await screen.findByText('Not saved yet')
    fireEvent.change(slider('Target score'), { target: { value: '80' } })
    await user.click(screen.getByRole('radio', { name: /Least time for my target/ }))
    await user.click(screen.getByRole('button', { name: /Save plan/ }))

    const doc = await data(mock.invoke('library.get', { docId }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('plan.save', {
        docId,
        input: {
          examDate: toLocalDay(doc.examDate),
          totalHours: null,
          hoursPerDay: 2,
          targetScore: 0.8,
          mode: 'min_time',
          format: 'mixed',
          overrides: [],
          reserveFraction: 0.2
        }
      })
    )
    expect(await screen.findByText('Saved')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Save plan/ }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('asks to index the book first when there are no topics', async () => {
    const { mock } = renderApp('/book/probability-notes/plan')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    expect(await screen.findByRole('heading', { name: 'Index the book first' })).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Index the book' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('index.start', { docId: 'probability-notes' }))
  })

  it('lists every book on the Planner screen with a link to its plan', async () => {
    renderApp('/planner')
    const link = await screen.findByRole('link', { name: 'Make a plan for Optical Networks' })
    expect(link.getAttribute('href')).toBe('/book/optical-networks/plan')
    expect(
      await screen.findByRole('link', { name: 'Open the plan for Signals and Systems: Lecture Slides' })
    ).toBeTruthy()
  })
})
