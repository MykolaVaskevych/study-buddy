import { questionKeyAction } from './keys'
import type { QuestionKeyContext } from './keys'

const key = (k: string, mods: Partial<{ ctrlKey: boolean; shiftKey: boolean }> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

const ctx: QuestionKeyContext = { choices: 4, holdDigits: true, onControl: false, canReport: true }

describe('questionKeyAction', () => {
  it('maps digits to options within range', () => {
    expect(questionKeyAction(key('1'), ctx)).toEqual({ type: 'choice', index: 0 })
    expect(questionKeyAction(key('4'), ctx)).toEqual({ type: 'choice', index: 3 })
  })

  it('swallows other digits while a question is up, so the reader does not switch tabs', () => {
    expect(questionKeyAction(key('5'), ctx)).toEqual({ type: 'swallow' })
    expect(questionKeyAction(key('2'), { ...ctx, choices: 0 })).toEqual({ type: 'swallow' })
    expect(questionKeyAction(key('2'), { ...ctx, choices: 0, holdDigits: false })).toBeNull()
  })

  it('leaves Enter to focused buttons and ignores modifiers', () => {
    expect(questionKeyAction(key('Enter'), ctx)).toEqual({ type: 'enter' })
    expect(questionKeyAction(key('Enter'), { ...ctx, onControl: true })).toBeNull()
    expect(questionKeyAction(key('1', { ctrlKey: true }), ctx)).toBeNull()
  })

  it('reports with r when allowed', () => {
    expect(questionKeyAction(key('r'), ctx)).toEqual({ type: 'report' })
    expect(questionKeyAction(key('r'), { ...ctx, canReport: false })).toBeNull()
  })
})
