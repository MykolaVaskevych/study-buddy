/** Files LibreOffice turns into PDF at import: slides, documents and rich text. */
export const OFFICE_EXTENSIONS = ['pptx', 'ppt', 'ppsx', 'pps', 'odp', 'docx', 'doc', 'odt', 'rtf'] as const

/** Notes rendered to PDF by the app (with formulas). */
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'txt'] as const

/** Photos and screenshots, one page per image (WebP is not supported: pdf-lib cannot embed it). */
export const IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg'] as const

/** Everything the library imports. */
export const IMPORT_EXTENSIONS = [
  'pdf',
  ...OFFICE_EXTENSIONS,
  ...MARKDOWN_EXTENSIONS,
  ...IMAGE_EXTENSIONS
] as const

const extensionOf = (name: string): string => /\.([^./\\]+)$/.exec(name)?.[1]?.toLowerCase() ?? ''

/** True for files the library can import (by extension). */
export const isImportable = (name: string): boolean =>
  (IMPORT_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** True for office files that are converted to PDF first. */
export const needsConversion = (name: string): boolean =>
  (OFFICE_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** True for Markdown and plain-text notes. */
export const isMarkdown = (name: string): boolean =>
  (MARKDOWN_EXTENSIONS as readonly string[]).includes(extensionOf(name))

/** True for PNG and JPEG images. */
export const isImage = (name: string): boolean =>
  (IMAGE_EXTENSIONS as readonly string[]).includes(extensionOf(name))
