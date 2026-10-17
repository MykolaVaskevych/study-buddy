import { readerKeyAction, targetPage } from './keys'
import type { KeyContext } from './keys'

const key = (
  k: string,
  mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean }> = {}
) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods
})

describe('readerKeyAction', () => {
  it('maps j/k to next/previous page', () => {
    expect(readerKeyAction(key('j'), 'viewer')).toEqual({ type: 'page', delta: 1 })
    expect(readerKeyAction(key('k'), 'viewer')).toEqual({ type: 'page', delta: -1 })
  })

  it('maps g/G to first/last and PgUp/PgDn in the viewer', () => {
    expect(readerKeyAction(key('g'), 'viewer')).toEqual({ type: 'first' })
    expect(readerKeyAction(key('G', { shiftKey: true }), 'viewer')).toEqual({ type: 'last' })
    expect(readerKeyAction(key('PageDown'), 'viewer')).toEqual({ type: 'page', delta: 1 })
    expect(readerKeyAction(key('PageUp'), 'viewer')).toEqual({ type: 'page', delta: -1 })
  })

  it('leaves PgUp/PgDn to side panels so they scroll natively', () => {
    expect(readerKeyAction(key('PageDown'), 'panel')).toBeNull()
    expect(readerKeyAction(key('j'), 'panel')).toEqual({ type: 'page', delta: 1 })
  })

  it('maps Ctrl +/-/0 to zoom and fit width', () => {
    expect(readerKeyAction(key('=', { ctrlKey: true }), 'viewer')).toEqual({ type: 'zoom', dir: 1 })
    expect(readerKeyAction(key('+', { ctrlKey: true, shiftKey: true }), 'viewer')).toEqual({
      type: 'zoom',
      dir: 1
    })
    expect(readerKeyAction(key('-', { metaKey: true }), 'viewer')).toEqual({ type: 'zoom', dir: -1 })
    expect(readerKeyAction(key('0', { ctrlKey: true }), 'viewer')).toEqual({ type: 'fitWidth' })
  })

  it('maps [ ] to panes and digits to study tabs', () => {
    expect(readerKeyAction(key('['), 'viewer')).toEqual({ type: 'togglePane', side: 'left' })
    expect(readerKeyAction(key(']'), 'viewer')).toEqual({ type: 'togglePane', side: 'right' })
    expect(readerKeyAction(key('2'), 'viewer')).toEqual({ type: 'tab', index: 1 })
  })

  it.each<KeyContext>(['editable'])('ignores everything while typing (%s)', (ctx) => {
    expect(readerKeyAction(key('j'), ctx)).toBeNull()
    expect(readerKeyAction(key('=', { ctrlKey: true }), ctx)).toBeNull()
  })

  it('ignores other modifier combos', () => {
    expect(readerKeyAction(key('j', { ctrlKey: true }), 'viewer')).toBeNull()
    expect(readerKeyAction(key('j', { altKey: true }), 'viewer')).toBeNull()
  })
})

describe('targetPage', () => {
  it('moves and clamps to the document', () => {
    expect(targetPage({ type: 'page', delta: 1 }, 5, 146)).toBe(6)
    expect(targetPage({ type: 'page', delta: -1 }, 1, 146)).toBe(1)
    expect(targetPage({ type: 'page', delta: 1 }, 146, 146)).toBe(146)
    expect(targetPage({ type: 'first' }, 80, 146)).toBe(1)
    expect(targetPage({ type: 'last' }, 3, 146)).toBe(146)
  })
  it('returns null for non-navigation actions', () => {
    expect(targetPage({ type: 'fitWidth' }, 3, 10)).toBeNull()
  })
})
