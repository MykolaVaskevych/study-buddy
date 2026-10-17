import type { MenuItemConstructorOptions } from 'electron'
import { describe, expect, it } from 'vitest'
import { buildMenuTemplate } from './menu'

function flatten(items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] {
  return items.flatMap((item) => [item, ...(Array.isArray(item.submenu) ? flatten(item.submenu) : [])])
}

const roles = (items: MenuItemConstructorOptions[]) => flatten(items).map((i) => i.role)

describe('buildMenuTemplate', () => {
  const variants = [
    { isDev: true, isMac: false },
    { isDev: false, isMac: false },
    { isDev: true, isMac: true },
    { isDev: false, isMac: true }
  ]

  it.each(variants)('has no zoom items or zoom accelerators (%o)', (v) => {
    const items = flatten(buildMenuTemplate({ ...v, appName: 'Study Buddy' }))
    for (const role of ['zoomIn', 'zoomOut', 'resetZoom'])
      expect(items.map((i) => i.role)).not.toContain(role)
    for (const item of items)
      expect(String(item.accelerator ?? '')).not.toMatch(
        /(CmdOrCtrl|CommandOrControl|Ctrl|Control|Cmd)\+(=|-|0|Plus)/i
      )
  })

  it.each(variants)('keeps the clipboard items (%o)', (v) => {
    const r = roles(buildMenuTemplate({ ...v, appName: 'Study Buddy' }))
    for (const role of ['cut', 'copy', 'paste', 'selectAll', 'undo', 'redo']) expect(r).toContain(role)
  })

  it('offers reload and devtools only in development', () => {
    const devRoles = roles(buildMenuTemplate({ isDev: true, isMac: false, appName: 'Study Buddy' }))
    const prodRoles = roles(buildMenuTemplate({ isDev: false, isMac: false, appName: 'Study Buddy' }))
    for (const role of ['reload', 'forceReload', 'toggleDevTools']) {
      expect(devRoles).toContain(role)
      expect(prodRoles).not.toContain(role)
    }
  })

  it('adds the app menu on macOS only', () => {
    expect(buildMenuTemplate({ isDev: false, isMac: true, appName: 'Study Buddy' })[0]?.label).toBe(
      'Study Buddy'
    )
    expect(buildMenuTemplate({ isDev: false, isMac: false, appName: 'Study Buddy' })[0]?.label).toBe('File')
  })
})
