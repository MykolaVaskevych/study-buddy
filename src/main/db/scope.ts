import { and, eq, inArray, isNull, or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import type { Scope, TopicId } from '@shared/domain'
import type { Drizzle } from './context'
import { topics } from './schema'

/** Columns shared by cards and questions that scope filtering needs. */
export interface ScopedTable {
  docId: AnySQLiteColumn
  topicId: AnySQLiteColumn
  sourcePages: AnySQLiteColumn
}

/** True when any page in the row's JSON `source_pages` lies in [from, to]. */
export function citesPagesIn(column: AnySQLiteColumn, from: number, to: number): SQL {
  return sql`exists (select 1 from json_each(${column}) where json_each.value between ${from} and ${to})`
}

/**
 * WHERE clause for "items in this scope".
 * - page / range: the item cites a page inside it.
 * - topic: the item belongs to the topic or one of its subtopics, or has no topic yet but cites a page
 *   in the topic's range (items generated before the topic map existed still show up).
 * - document: everything of the document.
 */
export function scopeCondition(db: Drizzle, table: ScopedTable, scope: Scope): SQL {
  const ofDoc = eq(table.docId, scope.docId)
  switch (scope.kind) {
    case 'document':
      return ofDoc
    case 'page':
      return and(ofDoc, citesPagesIn(table.sourcePages, scope.page, scope.page)) ?? ofDoc
    case 'range': {
      const from = Math.min(scope.from, scope.to)
      const to = Math.max(scope.from, scope.to)
      return and(ofDoc, citesPagesIn(table.sourcePages, from, to)) ?? ofDoc
    }
    case 'topic': {
      const rows = db
        .select({
          id: topics.id,
          parentId: topics.parentId,
          pageStart: topics.pageStart,
          pageEnd: topics.pageEnd
        })
        .from(topics)
        .where(eq(topics.docId, scope.docId))
        .all()
      const root = rows.find((t) => t.id === scope.topicId)
      if (!root) return sql`0`
      const ids = descendantIds(rows, root.id)
      const unassignedInRange = and(
        isNull(table.topicId),
        citesPagesIn(table.sourcePages, root.pageStart, root.pageEnd)
      )
      return and(ofDoc, or(inArray(table.topicId, ids), unassignedInRange)) ?? ofDoc
    }
  }
}

/** The topic itself plus all subtopics. Cycle-safe (a malformed parent chain cannot loop forever). */
export function descendantIds(rows: { id: TopicId; parentId: TopicId | null }[], rootId: TopicId): TopicId[] {
  const children = new Map<TopicId, TopicId[]>()
  for (const row of rows) {
    if (row.parentId === null) continue
    const list = children.get(row.parentId) ?? []
    list.push(row.id)
    children.set(row.parentId, list)
  }
  const seen = new Set<TopicId>([rootId])
  const stack = [rootId]
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    for (const child of children.get(id) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      stack.push(child)
    }
  }
  return [...seen]
}
