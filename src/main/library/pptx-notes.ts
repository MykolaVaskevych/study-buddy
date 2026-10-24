import { strFromU8, unzipSync } from 'fflate'

/**
 * Speaker notes of a PowerPoint deck, one entry per slide in show order ('' when a slide has
 * none). Lecturers often put the real explanation there; LibreOffice's PDF export drops it, so
 * the library adds it to each page's text for search, indexing and the page check.
 *
 * A .pptx is a zip of XML parts: presentation.xml lists the slides (r:id → slideN.xml through
 * presentation.xml.rels), each slide's rels point at its notes slide, and the notes text sits in
 * the notes slide's body placeholder. Unreadable decks give no notes rather than failing an import.
 */
export function pptxNotes(bytes: Uint8Array): string[] {
  let files: Record<string, Uint8Array>
  try {
    files = unzipSync(bytes, {
      filter: (f) => (f.name.startsWith('ppt/') && f.name.endsWith('.xml')) || f.name.endsWith('.rels')
    })
  } catch {
    return []
  }
  const read = (path: string): string => {
    const file = files[path]
    return file ? strFromU8(file) : ''
  }
  const rels = (path: string): Map<string, string> =>
    new Map(
      [...read(path).matchAll(/<Relationship\b[^>]*>/g)].flatMap((m) => {
        const id = /\bId="([^"]+)"/.exec(m[0])?.[1]
        const target = /\bTarget="([^"]+)"/.exec(m[0])?.[1]
        return id && target ? [[id, target] as const] : []
      })
    )
  const presentationRels = rels('ppt/_rels/presentation.xml.rels')
  const slideIds = [...read('ppt/presentation.xml').matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].flatMap(
    (m) => (m[1] ? [m[1]] : [])
  )
  return slideIds.map((rid) => {
    const slide = resolve('ppt', presentationRels.get(rid) ?? '')
    const slideName = slide.split('/').pop() ?? ''
    const slideRels = rels(`ppt/slides/_rels/${slideName}.rels`)
    const notesTarget = [...slideRels.values()].find((t) => /notesSlide\d*\.xml$/.test(t))
    return notesTarget ? notesText(read(resolve('ppt/slides', notesTarget))) : ''
  })
}

/** "../notesSlides/notesSlide3.xml" relative to "ppt/slides" → "ppt/notesSlides/notesSlide3.xml". */
function resolve(base: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1)
  const parts = base.split('/')
  for (const part of target.split('/')) {
    if (part === '..') parts.pop()
    else if (part !== '.' && part !== '') parts.push(part)
  }
  return parts.join('/')
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }

/** The body placeholder's paragraphs (not the slide image or the slide-number placeholder). */
function notesText(xml: string): string {
  const shapes = [...xml.matchAll(/<p:sp\b[\s\S]*?<\/p:sp>/g)].map((m) => m[0])
  const body = shapes.find((s) => /<p:ph\b[^>]*\btype="body"/.test(s))
  if (!body) return ''
  return [...body.matchAll(/<a:p\b[\s\S]*?<\/a:p>/g)]
    .map((p) =>
      [...p[0].matchAll(/<a:t>([^<]*)<\/a:t>/g)]
        .map((t) => t[1] ?? '')
        .join('')
        .replace(/&(amp|lt|gt|quot|apos);/g, (_, e: string) => ENTITIES[e] ?? '')
        .trim()
    )
    .filter(Boolean)
    .join('\n')
}
