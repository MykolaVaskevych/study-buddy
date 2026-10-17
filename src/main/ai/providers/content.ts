import { readFile as fsReadFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { AiError, type PromptPart } from '@shared/ai/provider'

/**
 * Prompt parts loaded into memory, ready to be turned into SDK content blocks. PDFs travel as
 * base64 `document` blocks: the API then gives the model both the text layer and an image of
 * every page, which is what image-only slides need.
 */

export type ReadFileFn = (path: string) => Promise<Uint8Array>

export type LoadedPart =
  { type: 'text'; text: string } | { type: 'pdf'; base64: string; title: string | null }

export const defaultReadFile: ReadFileFn = (path) => fsReadFile(path)

/** Reads every PDF part; a missing or unreadable file is a non-retryable AiError. */
export async function loadParts(parts: readonly PromptPart[], readFile: ReadFileFn): Promise<LoadedPart[]> {
  return Promise.all(
    parts.map(async (part): Promise<LoadedPart> => {
      if (part.type === 'text') return part
      try {
        const bytes = await readFile(part.path)
        return { type: 'pdf', base64: Buffer.from(bytes).toString('base64'), title: part.title ?? null }
      } catch (cause) {
        throw new AiError('unknown', `Cannot read PDF part ${basename(part.path)}`, {
          retryable: false,
          cause
        })
      }
    })
  )
}
