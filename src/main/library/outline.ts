import type { OutlineItem } from '@shared/domain'

/** The fields of a pdf.js outline node that matter here. */
export interface RawOutlineNode {
  title: string
  /** Named destination, explicit destination array, or null (e.g. external links). */
  dest: string | unknown[] | null
  items: RawOutlineNode[]
}

/** Resolves a destination to a 1-based page number, or null when it does not point into the document. */
export type DestinationResolver = (dest: string | unknown[]) => Promise<number | null>

/**
 * Converts a pdf.js outline into domain outline items, keeping the tree. The resolver is injected so
 * the tree walk is testable without pdf.js; failures to resolve an entry yield `page: null` instead of
 * failing the whole import, because outlines in the wild often contain dangling destinations.
 */
export async function resolveOutline(
  nodes: readonly RawOutlineNode[],
  resolve: DestinationResolver
): Promise<OutlineItem[]> {
  return Promise.all(
    nodes.map(async (node) => ({
      title: node.title.replace(/\s+/g, ' ').trim(),
      page: node.dest === null ? null : await resolve(node.dest).catch(() => null),
      children: await resolveOutline(node.items, resolve)
    }))
  )
}

/** Counts all outline entries in a tree (handy for logs and checks). */
export function countOutlineItems(items: readonly OutlineItem[]): number {
  return items.reduce((sum, item) => sum + 1 + countOutlineItems(item.children), 0)
}
