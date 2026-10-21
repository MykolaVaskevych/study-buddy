import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { writeFixturePdf } from '../../../tests/fixtures/make-fixture-pdf'
import { createPdfLibrary, DEFAULT_CHUNK_OPTIONS } from './index'
import { markdownTitle } from './markdown'
import { makeTempDir } from './test-pdfs'

let tmp: Awaited<ReturnType<typeof makeTempDir>>
let fixture: string
beforeAll(async () => {
  tmp = await makeTempDir()
  fixture = await writeFixturePdf(join(tmp.dir, 'src'))
})
afterAll(() => tmp.cleanup())

describe('markdown notes', () => {
  it('takes the first heading as the title', () => {
    expect(markdownTitle('﻿# WEEK 1, LECTURE 1.1: **From Bits** to Qubits\n\ntext', 'x')).toBe(
      'WEEK 1, LECTURE 1.1: From Bits to Qubits'
    )
    expect(markdownTitle('## Only a subheading\n#hashtag', 'W1_L1.1_Bits_to_Qubits')).toBe(
      'W1_L1.1_Bits_to_Qubits'
    )
  })

  it('prints the notes once with the renderer and reuses the PDF on re-import', async () => {
    const calls: { markdown: string; title: string }[] = []
    const library = createPdfLibrary(
      { rootDir: join(tmp.dir, 'lib-md'), chunk: DEFAULT_CHUNK_OPTIONS },
      {
        inWorker: false,
        markdownToPdf: async (markdown, title) => {
          calls.push({ markdown, title })
          // Different bytes per run, like a real print.
          return Buffer.concat([await readFile(fixture), Buffer.from(`\n%${calls.length}\n`)])
        }
      }
    )
    const notes = join(tmp.dir, 'src', 'W1_L1.1_Bits_to_Qubits.md')
    await writeFile(notes, '# From Bits to Qubits\n\n$$|0\\rangle$$\n')
    const first = await library.importPdf(notes)
    expect(first.title).toBe('From Bits to Qubits')
    expect(calls).toEqual([
      { markdown: '# From Bits to Qubits\n\n$$|0\\rangle$$\n', title: 'From Bits to Qubits' }
    ])
    const again = await library.importPdf(notes)
    expect(again.sha256).toBe(first.sha256)
    expect(calls).toHaveLength(1)
  })
})
