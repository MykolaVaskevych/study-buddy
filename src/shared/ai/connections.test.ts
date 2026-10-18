import { describe, expect, it } from 'vitest'
import { isLocalUrl, OPENAI_PRESETS, presetFor } from './connections'

describe('presetFor', () => {
  it('matches a preset URL with or without a trailing slash', () => {
    expect(presetFor('http://localhost:11434/v1').id).toBe('ollama')
    expect(presetFor('http://localhost:11434/v1/').id).toBe('ollama')
    expect(presetFor('https://api.deepseek.com/v1').maxTokens).toBe(8192)
  })

  it('falls back to custom', () => {
    expect(presetFor('http://192.168.1.5:8000/v1').id).toBe('custom')
    expect(presetFor('').id).toBe('custom')
  })

  it('lists custom last so the UI shows it at the end', () => {
    expect(OPENAI_PRESETS.at(-1)?.id).toBe('custom')
  })
})

describe('isLocalUrl', () => {
  it('accepts loopback hosts only', () => {
    expect(isLocalUrl('http://localhost:1234/v1')).toBe(true)
    expect(isLocalUrl('http://127.0.0.1:8080/v1')).toBe(true)
    expect(isLocalUrl('http://[::1]:8080/v1')).toBe(true)
    expect(isLocalUrl('https://api.deepseek.com/v1')).toBe(false)
    expect(isLocalUrl('not a url')).toBe(false)
  })
})
