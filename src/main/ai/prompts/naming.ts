import { headerLines, languageInstruction } from './common'
import { tagged } from './grade'

/** Course and file names from what the files contain (fast tier, text only). */

export const NAMING_SYSTEM = `You name a student's course and the files in it from what the files contain.
- course_name: the subject, 2 to 5 words, as a course catalogue would write it (e.g. "Optical Networks", "Linear Algebra"). No course codes, years or lecturer names.
- files: one title per listed file, by its index. 3 to 8 words saying what the file is and what it covers, e.g. "Week 3: Dispersion and PMD", "Lecture notes: Lasers and LEDs", "Past exam 2024 with answers".
- Keep numbering that orders the files (week, lecture, chapter, part) when the current name or the content has it.
- If the current name is already clear and specific, return it unchanged.
- Use only what the material shows; never invent topics.`

export interface NamingFile {
  title: string
  pageCount: number
  /** Chapter or topic titles, in order. */
  contents: string[]
  /** The start of the first page's text (title slides often say what the file is). */
  opening: string
}

export function buildNamingUser(input: { files: readonly NamingFile[]; language: string }): string {
  const files = input.files.map((f, i) =>
    [
      `[${i}] current name: ${f.title}`,
      `pages: ${f.pageCount}`,
      f.contents.length > 0 ? `contents: ${f.contents.slice(0, 15).join('; ')}` : null,
      f.opening ? `first page: ${f.opening.replace(/\s+/g, ' ').slice(0, 300)}` : null
    ]
      .filter((line) => line !== null)
      .join('\n')
  )
  return [
    headerLines({ Task: 'naming', Files: input.files.length }),
    languageInstruction(input.language),
    tagged('files', files.join('\n\n'))
  ].join('\n\n')
}
