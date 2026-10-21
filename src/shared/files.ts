/** Files LibreOffice turns into PDF at import: slides, documents and rich text. */
export const OFFICE_EXTENSIONS = ['pptx', 'ppt', 'ppsx', 'pps', 'odp', 'docx', 'doc', 'odt', 'rtf'] as const

/** Everything the library imports. */
export const IMPORT_EXTENSIONS = ['pdf', ...OFFICE_EXTENSIONS] as const

const extensionOf = (name: string): string => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

/** True for files the library can import (by extension). */
export const isImportable = (name: string): boolean =>
  (IMPORT_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** True for office files that are converted to PDF first. */
export const needsConversion = (name: string): boolean =>
  (OFFICE_EXTENSIONS as readonly string[]).includes(extensionOf(name))
