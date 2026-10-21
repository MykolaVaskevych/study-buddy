import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

const KEY = 'sk-ant-api03-test-secret-0123456789'

describe('SettingsScreen', () => {
  it('saves the API key through settings.setApiKey and never shows it', async () => {
    const { mock, container } = renderApp('/settings')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: /Anthropic API key/ }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.update', { provider: 'anthropic-api' }))

    const field = await screen.findByLabelText('API key')
    expect(field.getAttribute('type')).toBe('password')
    await user.type(field, KEY)
    await user.click(screen.getByRole('button', { name: 'Save key' }))

    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.setApiKey', { apiKey: KEY, provider: 'anthropic-api' })
    )
    expect(await screen.findByText('Key saved')).toBeTruthy()
    expect(screen.queryByDisplayValue(KEY)).toBeNull()
    expect(container.innerHTML).not.toContain(KEY)
    expect(document.body.innerHTML).not.toContain(KEY)
  })

  it('tests the connection and shows the model and latency', async () => {
    renderApp('/settings')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Test connection' }))
    expect(await screen.findByText('Connected.')).toBeTruthy()
    expect(screen.getByText(/haiku answered in 1,840 ms/)).toBeTruthy()
  })

  it('updates toggles, models and the theme', async () => {
    const { mock } = renderApp('/settings')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await user.click(await screen.findByRole('switch', { name: 'Prepare page checks while you read' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('settings.update', { prefetchPageChecks: false }))

    const smart = screen.getByLabelText('Smart model')
    await user.clear(smart)
    await user.type(smart, 'sonnet{Enter}')
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.update', {
        models: {
          'claude-code': { fast: 'haiku', smart: 'sonnet' },
          'anthropic-api': { fast: 'claude-haiku-5-5', smart: 'claude-opus-5-5' },
          'openai-compatible': { fast: 'qwen3.6:27b', smart: 'qwen3.6:27b' },
          codex: { fast: 'gpt-6-luna', smart: 'gpt-6.1-sol' }
        }
      })
    )

    await user.click(screen.getByRole('radio', { name: 'Dark' }))
    await waitFor(() => expect(document.documentElement.dataset['theme']).toBe('dark'))
    expect(await screen.findByText(/Notional: your Claude subscription covers this/)).toBeTruthy()
  })
})
