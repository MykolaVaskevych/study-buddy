import type { MenuItemConstructorOptions } from 'electron'

/**
 * Application menu template (pure, so it is unit-tested). It deliberately has no zoomIn / zoomOut /
 * resetZoom items: their accelerators (Ctrl+= / Ctrl+- / Ctrl+0) would be swallowed by the menu,
 * and the renderer uses those keys to zoom the PDF. Reload and devtools exist only in development.
 */
export function buildMenuTemplate(opts: {
  isDev: boolean
  isMac: boolean
  appName: string
}): MenuItemConstructorOptions[] {
  const { isDev, isMac, appName } = opts
  const sep: MenuItemConstructorOptions = { type: 'separator' }

  const appMenu: MenuItemConstructorOptions[] = isMac
    ? [
        {
          label: appName,
          submenu: [
            { role: 'about' },
            sep,
            { role: 'services' },
            sep,
            { role: 'hide' },
            { role: 'hideOthers' },
            { role: 'unhide' },
            sep,
            { role: 'quit' }
          ]
        }
      ]
    : []

  const devItems: MenuItemConstructorOptions[] = isDev
    ? [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, sep]
    : []

  return [
    ...appMenu,
    { label: 'File', submenu: [isMac ? { role: 'close' } : { role: 'quit' }] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        sep,
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac ? [{ role: 'pasteAndMatchStyle' } as const] : []),
        { role: 'delete' },
        sep,
        { role: 'selectAll' }
      ]
    },
    { label: 'View', submenu: [...devItems, { role: 'togglefullscreen' }] },
    {
      label: 'Window',
      submenu: isMac
        ? [{ role: 'minimize' }, { role: 'zoom' }, sep, { role: 'front' }]
        : [{ role: 'minimize' }, { role: 'close' }]
    }
  ]
}
