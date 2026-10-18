import type { DocId, LessonExercise, LessonSection, TopicId } from '@shared/domain'
import type { JobContext } from '../jobs/types'
import { fatal } from './errors'
import type { Material } from './material'
import { parsePayload, writeLessonPayload, type WriteLessonPayload } from './payloads'
import { PRIORITY } from './priorities'
import { leafTopics, requireDoc, resolveScope } from './scope'
import { ServiceError, type Handlers, type PipelineDeps } from './types'
import type { UsageLedger } from './usage'

export interface Lessons {
  handlers: Pick<Handlers, 'lessons.list' | 'lessons.generate'>
  runJob(payload: unknown, ctx: JobContext): Promise<void>
}

/** Study book: one AI-written chapter per topic, grounded in the topic's pages. */
export function createLessons(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'emit' | 'now'>,
  services: { ledger: UsageLedger; material: Material }
): Lessons {
  const { db, queue } = deps

  const enqueue = (docId: DocId, topicId: TopicId, title: string): void => {
    queue.enqueue<WriteLessonPayload>({
      kind: 'write_lesson',
      docId,
      payload: { docId, topicId },
      priority: PRIORITY.requested,
      dedupeKey: `lesson:${docId}:${topicId}`,
      label: `Study book: ${title}`
    })
  }

  return {
    async runJob(raw, ctx) {
      const p = parsePayload(writeLessonPayload, raw)
      const doc = db.documents.get(p.docId)
      const topic = db.topics.get(p.topicId)
      if (!doc || !topic) return
      const resolved = resolveScope(db, { kind: 'topic', docId: p.docId, topicId: p.topicId })
      const windows = await services.material.windows(resolved, false)
      const sections: LessonSection[] = []
      const exercises: LessonExercise[] = []
      for (const [i, window] of windows.entries()) {
        ctx.progress(i / windows.length)
        const gen = await services.material.context(doc, window, ctx.signal)
        const part = await services.ledger.run(doc.id, (ai) =>
          ai.writeLesson(gen, { title: topic.title, objectives: topic.objectives })
        )
        sections.push(...part.sections)
        exercises.push(...part.exercises)
      }
      if (sections.length === 0) throw fatal(`No study-book chapter came back for "${topic.title}"`)
      if (!db.documents.get(doc.id) || !db.topics.get(topic.id)) return
      db.lessons.save({ docId: doc.id, topicId: topic.id, sections, exercises }, deps.now().toISOString())
      deps.emit('library.changed', { docId: doc.id })
    },

    handlers: {
      async 'lessons.list'({ docId }) {
        requireDoc(db, docId)
        return db.lessons.list(docId)
      },

      async 'lessons.generate'({ docId, topicId }) {
        requireDoc(db, docId)
        const topics = db.topics.list(docId)
        if (topics.length === 0)
          throw new ServiceError(
            'validation',
            'The course map is not ready yet: lessons are written per topic.'
          )
        if (topicId !== null) {
          const topic = topics.find((t) => t.id === topicId)
          if (!topic) throw new ServiceError('not_found', `Topic ${topicId} not found`)
          enqueue(docId, topic.id, topic.title)
          return { queued: 1 }
        }
        const written = new Set(db.lessons.list(docId).map((l) => l.topicId))
        const todo = leafTopics(topics).filter((t) => !written.has(t.id))
        for (const t of todo) enqueue(docId, t.id, t.title)
        return { queued: todo.length }
      }
    }
  }
}
