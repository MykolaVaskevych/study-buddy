import type { DocId, ExamProfile } from '@shared/domain'
import { defaultProfile } from '../ai/prompts/exam-profile'
import type { Database } from '../db/types'
import { leafTopics, requireDoc } from './scope'
import type { Handlers, PipelineDeps } from './types'

/** The stored profile, else one derived from the saved plan's exam format. */
export function resolveExamProfile(db: Database, docId: DocId): ExamProfile {
  return db.examProfiles.get(docId) ?? defaultProfile(docId, db.plans.get(docId)?.input.format ?? null)
}

/** Shares that sum to 1 (all-zero input becomes an even mix). */
export function normaliseFormats(f: ExamProfile['formats']): ExamProfile['formats'] {
  const sum = f.mcq + f.written + f.numeric
  if (sum <= 0) return { mcq: 1 / 3, written: 1 / 3, numeric: 1 / 3 }
  return { mcq: f.mcq / sum, written: f.written / sum, numeric: f.numeric / sum }
}

/**
 * Exam profile channels and "rebuild flashcards for this exam": cards that do not fit the exam are
 * suspended (never deleted) and new essentials decks are written per topic, following the profile.
 */
export function createExamProfiles(
  deps: Pick<PipelineDeps, 'db' | 'emit' | 'now'>,
  services: { generateCards: Handlers['cards.generate'] }
): { handlers: Pick<Handlers, 'exam.getProfile' | 'exam.saveProfile' | 'cards.rebuildForExam'> } {
  const { db } = deps
  return {
    handlers: {
      async 'exam.getProfile'({ docId }) {
        requireDoc(db, docId)
        return resolveExamProfile(db, docId)
      },

      async 'exam.saveProfile'({ docId, formats, formulas, formulaSheet }) {
        requireDoc(db, docId)
        const current = resolveExamProfile(db, docId)
        // What a past paper taught (style, examples) is kept; the student's answers win otherwise.
        const saved = db.examProfiles.save(
          { ...current, formats: normaliseFormats(formats), formulas, formulaSheet, source: 'user' },
          deps.now().toISOString()
        )
        deps.emit('library.changed', { docId })
        return saved
      },

      async 'cards.rebuildForExam'({ docId }) {
        requireDoc(db, docId)
        const profile = resolveExamProfile(db, docId)
        let suspended = 0
        if (profile.formulas === 'none') {
          for (const card of db.cards.list({ kind: 'document', docId }, false)) {
            if (card.type !== 'formula') continue
            db.cards.update(card.id, { status: 'suspended' })
            suspended++
          }
        }
        const skipped = new Set(
          db.plans
            .get(docId)
            ?.result.items.filter((i) => i.level === 'skip')
            .map((i) => i.topicId) ?? []
        )
        let queued = 0
        for (const t of leafTopics(db.topics.list(docId))) {
          if (skipped.has(t.id)) continue
          await services.generateCards({
            scope: { kind: 'topic', docId, topicId: t.id },
            essentialsOnly: true,
            count: null
          })
          queued++
        }
        deps.emit('cards.changed', { docId })
        return { suspended, queued }
      }
    }
  }
}
