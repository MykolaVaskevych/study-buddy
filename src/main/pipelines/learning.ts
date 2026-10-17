import type { DocId, TopicId } from '@shared/domain'
import type { Database } from '../db/types'

/** Topic attribution and mastery evidence shared by cards, questions and quizzes. */

/** Topic of an item: the deepest topic containing its first source page, or null before the topic map. */
export function topicForPages(db: Database, docId: DocId, pages: readonly number[]): TopicId | null {
  const valid = pages.filter((p) => Number.isInteger(p) && p >= 1)
  if (valid.length === 0) return null
  return db.topics.forPage(docId, Math.min(...valid))?.id ?? null
}

/** The item's own topic, else the topic of its first source page. */
export function resolveTopic(
  db: Database,
  item: { docId: DocId; topicId: TopicId | null; sourcePages: readonly number[] }
): TopicId | null {
  return item.topicId ?? topicForPages(db, item.docId, item.sourcePages)
}

/** One right or wrong answer as evidence for a topic's Beta mastery belief. No topic, no evidence. */
export function addEvidence(db: Database, topicId: TopicId | null, correct: boolean): void {
  if (topicId === null || !db.topics.get(topicId)) return
  db.topics.addMasteryEvidence(topicId, correct ? 1 : 0, correct ? 0 : 1)
}
