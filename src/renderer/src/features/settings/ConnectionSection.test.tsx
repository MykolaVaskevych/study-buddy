import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { renderApp } from '../../test/render'

describe('Claude subscription panel', () => {
  it('shows the signed-in account, signs out after a warning, and signs in with a pasted code', async () => {
    const { mock } = renderApp('/settings')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    expect(await screen.findByText('student@example.com · Pro plan')).toBeTruthy()
    await user.click(screen.getByRole('button', { name: 'Sign out' }))
    expect(screen.getByRole('alert').textContent).toContain('in your terminal too')
    await user.click(within(screen.getByRole('alert')).getByRole('button', { name: 'Sign out' }))
    expect(await screen.findByText('Not signed in')).toBeTruthy()

    await user.click(screen.getByRole('button', { name: 'Sign in with Claude' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai.claudeLogin', { method: 'claudeai' }))
    const again = await screen.findByRole('link', { name: 'Open the sign-in page again' })
    expect(again.getAttribute('href')).toContain('oauth/authorize')
    await user.type(screen.getByLabelText('Paste the code from the sign-in page'), 'abc#def')
    await user.click(screen.getByRole('button', { name: 'Finish sign-in' }))
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('ai.claudeLoginCode', { code: 'abc#def' }))
    expect(await screen.findByText('Signed in')).toBeTruthy()
  })
})

describe('Local or other model', () => {
  it('switches provider, lists the server models, and asks for a key only where needed', async () => {
    const { mock } = renderApp('/settings')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('radio', { name: /Local or other model/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.update', { provider: 'openai-compatible' })
    )
    expect(await screen.findByText(/2 models on the server/)).toBeTruthy()
    expect(screen.queryByLabelText(/Server API key/)).toBeNull()

    await user.click(screen.getByRole('radio', { name: 'LM Studio' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith(
        'settings.update',
        expect.objectContaining({ openaiBaseUrl: 'http://localhost:1234/v1' })
      )
    )
    expect(await screen.findByText(/ECONNREFUSED/)).toBeTruthy()

    await user.click(screen.getByRole('radio', { name: 'DeepSeek API' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.update', {
        openaiBaseUrl: 'https://api.deepseek.com/v1',
        models: expect.objectContaining({
          'openai-compatible': { fast: 'deepseek-chat', smart: 'deepseek-chat' }
        })
      })
    )
    const key = await screen.findByLabelText('Server API key')
    await user.type(key, 'sk-deepseek-0123456789')
    await user.click(screen.getByRole('button', { name: 'Save key' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.setApiKey', {
        apiKey: 'sk-deepseek-0123456789',
        provider: 'openai-compatible'
      })
    )
  })
})

describe('status bar switch', () => {
  it('switches AI in one click and explains what is not set up yet', async () => {
    const { mock } = renderApp('/')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: /Claude subscription/ }))
    const menu = screen.getByRole('menu', { name: 'AI in use' })
    const api = within(menu).getByRole('menuitemradio', { name: /Anthropic API key/ })
    expect(api.hasAttribute('disabled')).toBe(true)
    expect(api.textContent).toContain('Add your API key')
    await user.click(within(menu).getByRole('menuitemradio', { name: /Local: Ollama/ }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.update', { provider: 'openai-compatible' })
    )
    expect(await screen.findByRole('button', { name: /Local: Ollama/ })).toBeTruthy()
  })
})

describe('usage limit banner', () => {
  it('offers a local server that answers while the subscription is paused', async () => {
    const { mock } = renderApp('/')
    const invoke = vi.spyOn(mock, 'invoke')
    const user = userEvent.setup()
    await screen.findByRole('button', { name: /Claude subscription/ })
    act(() =>
      mock.emit('ai.rateLimited', {
        resetAt: new Date(Date.now() + 3_600_000).toISOString(),
        message: 'limit'
      })
    )
    await user.click(await screen.findByRole('button', { name: 'Use Ollama meanwhile' }))
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('settings.update', { provider: 'openai-compatible' })
    )
    // No key saved, so the API option is not offered.
    expect(screen.queryByRole('button', { name: 'Use my API key meanwhile' })).toBeNull()
  })
})
