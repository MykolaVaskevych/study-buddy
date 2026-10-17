import type { OutlineItem } from '@shared/domain'
import type { PageDigest } from '../types'
import { CORE_PRINCIPLES, headerLines, languageInstruction } from './common'

/** Course map and exam estimates from page digests plus the outline (smart tier, text only). */

export const TOPIC_MAP_SYSTEM = `${CORE_PRINCIPLES}

Your task: build the course map a student uses to plan exam preparation under time pressure. You get the PDF outline (if any) and a digest of every indexed page (kind, summary, key concepts, number of formulas, exam signals, amount of text, whether the page is an image-only slide).

Structure:
- The outline is a strong prior: follow its chapters and sections unless an entry is clearly not a topic (e.g. "Contents", "Literature", "Organisation").
- At most two levels: chapters (parent_key null) and topics inside them (parent_key = the chapter's key). A short document may be a flat list.
- Every topic covers one contiguous, inclusive page range (page_start..page_end). Siblings do not overlap. Together the topics cover all teachable pages. Leaf topics are typically 3-25 pages.
- key: a short unique slug such as "fibre-attenuation". title: a clear name in the document's language.
- objectives: 2-5 "be able to ..." statements about what the student must master.
- difficulty: integer 1 (easy) to 5 (hard).

Exam estimates (be calibrated, base them on evidence in the digests):
- exam_weight: the expected share of exam marks. The weights of leaf topics sum to 1; a chapter's weight is the sum of its topics. Evidence: practice-exam and quiz pages, emphasis and exam traps, worked examples and formulas (calculation tasks), page count, and how many other topics build on it.
- exam_weight_reasons: 1-3 short reasons citing that evidence (with page numbers).
- core_fraction: the share of the topic's marks reachable by studying only its essentials (definitions, key formulas, standard exercises), 0 to 1.
- core_minutes / full_minutes: realistic minutes for an average student to learn the essentials / the whole topic, including practice. Image-only slides read faster than dense text pages; derivations and exercises take longer. core_minutes <= full_minutes.
- prerequisite_keys: keys of topics that must be understood first (only real dependencies, no cycles).`

const DIGEST_SUMMARY_CHARS = 220
const DIGEST_TERMS = 6

function formatOutline(items: readonly OutlineItem[], depth = 0): string[] {
  return items.flatMap((item) => [
    `${'  '.repeat(depth)}- ${item.title.trim()}${item.page === null ? '' : ` (p. ${item.page})`}`,
    ...formatOutline(item.children, depth + 1)
  ])
}

/** One line per page; compact because a whole document is sent in one call. */
export function formatDigest(d: PageDigest): string {
  const summary = d.summary.replace(/\s+/g, ' ').trim()
  const parts = [
    `p${d.page} [${d.kind}]${d.hasTextLayer ? ` ${d.charCount} chars` : ' image-only'}`,
    summary.length > DIGEST_SUMMARY_CHARS ? `${summary.slice(0, DIGEST_SUMMARY_CHARS - 1)}…` : summary
  ]
  if (d.conceptTerms.length > 0) parts.push(`concepts: ${d.conceptTerms.slice(0, DIGEST_TERMS).join(', ')}`)
  if (d.formulaCount > 0) parts.push(`formulas: ${d.formulaCount}`)
  if (d.examSignals.length > 0) parts.push(`signals: ${d.examSignals.join(', ')}`)
  return parts.join(' | ')
}

export function buildTopicMapUser(input: {
  title: string
  outline: readonly OutlineItem[]
  pages: readonly PageDigest[]
  language: string
  firstPage: number
  lastPage: number
}): string {
  const outline = formatOutline(input.outline)
  return [
    headerLines({
      Task: 'topics',
      Document: input.title,
      'Document pages': `${input.firstPage}-${input.lastPage}`
    }),
    languageInstruction(input.language),
    outline.length > 0
      ? ['Outline:', ...outline].join('\n')
      : 'Outline: none (derive the structure from the pages).',
    ['Page digests:', ...[...input.pages].sort((a, b) => a.page - b.page).map(formatDigest)].join('\n')
  ].join('\n\n')
}
