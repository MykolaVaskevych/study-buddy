import { dialog } from 'electron'
import type { BaseWindow, OpenDialogOptions } from 'electron'
import { IMPORT_EXTENSIONS, OFFICE_EXTENSIONS } from '@shared/files'

export const PDF_OPEN_DIALOG: OpenDialogOptions = {
  title: 'Import files',
  buttonLabel: 'Import',
  properties: ['openFile', 'multiSelections'],
  filters: [
    { name: 'Study files (PDF, PowerPoint, Word, OpenDocument)', extensions: [...IMPORT_EXTENSIONS] },
    { name: 'PDF documents', extensions: ['pdf'] },
    { name: 'Slides and documents (converted with LibreOffice)', extensions: [...OFFICE_EXTENSIONS] }
  ]
}

/** Native multi-select "open files" dialog, modal to `win` when given. Resolves [] when cancelled. */
export async function pickPdfs(win: BaseWindow | null): Promise<string[]> {
  const result = win
    ? await dialog.showOpenDialog(win, PDF_OPEN_DIALOG)
    : await dialog.showOpenDialog(PDF_OPEN_DIALOG)
  return result.canceled ? [] : result.filePaths
}
