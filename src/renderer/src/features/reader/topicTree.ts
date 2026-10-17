import type { Topic } from '@shared/domain'

export interface TopicNode {
  topic: Topic
  children: TopicNode[]
}

/** Builds the course-map tree from the flat topic list (ordered by `order`). */
export function buildTopicTree(topics: Topic[]): TopicNode[] {
  const sorted = [...topics].sort((a, b) => a.order - b.order)
  const nodes = new Map(sorted.map((t) => [t.id, { topic: t, children: [] as TopicNode[] }]))
  const roots: TopicNode[] = []
  for (const t of sorted) {
    const node = nodes.get(t.id)
    if (!node) continue
    const parent = t.parentId ? nodes.get(t.parentId) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  return roots
}

/** Deepest topic whose page range contains `page`, or null. */
export function topicAt(topics: Topic[], page: number): Topic | null {
  let best: Topic | null = null
  for (const t of topics) {
    if (page < t.pageStart || page > t.pageEnd) continue
    if (!best || t.pageEnd - t.pageStart <= best.pageEnd - best.pageStart) best = t
  }
  return best
}
