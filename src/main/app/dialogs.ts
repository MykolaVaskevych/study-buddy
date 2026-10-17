import { dialog } from 'electron'
import type { BaseWindow, OpenDialogOptions } from 'electron'

export const PDF_OPEN_DIALOG: OpenDialogOptions = {
  title: 'Import PDFs',
  buttonLabel: 'Import',
  properties: ['openFile', 'multiSelections'],
  filters: [{ name: 'PDF documents', extensions: ['pdf'] }]
}

/** Native multi-select "open PDFs" dialog, modal to `win` when given. Resolves [] when cancelled. */
export async function pickPdfs(win: BaseWindow | null): Promise<string[]> {
  const result = win
    ? await dialog.showOpenDialog(win, PDF_OPEN_DIALOG)
    : await dialog.showOpenDialog(PDF_OPEN_DIALOG)
  return result.canceled ? [] : result.filePaths
}
