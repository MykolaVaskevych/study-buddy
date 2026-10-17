import type { DocId } from '@shared/domain'
import { openDatabase } from './index'
import type { Database, NewCard, NewDocument, NewQuestion } from './types'

/** Test-only: an in-memory database with a controllable clock and sequential ids. */
export function openTestDb(start = '2026-10-17T10:00:00.000Z'): {
  db: Database
  clock: { now: () => Date; set: (iso: string) => void; advance: (ms: number) => void }
} {
  let now = new Date(start)
  let seq = 0
  const db = openDatabase(':memory:', {
    now: () => new Date(now),
    newId: () => `id-${String(++seq).padStart(4, '0')}`
  })
  return {
    db,
    clock: {
      now: () => new Date(now),
      set: (iso) => {
        now = new Date(iso)
      },
      advance: (ms) => {
        now = new Date(now.getTime() + ms)
      }
    }
  }
}

export function newDocument(overrides: Partial<NewDocument> = {}): NewDocument {
  return {
    sha256: 'a'.repeat(64),
    title: 'Optical Networks',
    storedPath: '/library/a.pdf',
    pageCount: 20,
    outline: [{ title: 'Intro', page: 1, children: [] }],
    ...overrides
  }
}

/** Inserts a document with `pages` text pages and returns its id. */
export function seedDocument(db: Database, overrides: Partial<NewDocument> = {}, pages = 0): DocId {
  const { id } = db.documents.upsert(newDocument(overrides))
  if (pages > 0) {
    db.pages.insertPages(
      id,
      Array.from({ length: pages }, (_, i) => ({
        page: i + 1,
        label: String(i + 1),
        text: `Page ${i + 1} text`,
        charCount: 12,
        hasTextLayer: true
      }))
    )
  }
  return id
}

export function newCard(docId: DocId, overrides: Partial<NewCard> = {}): NewCard {
  return {
    docId,
    topicId: null,
    type: 'basic',
    front: 'What limits fiber reach?',
    back: 'Attenuation and dispersion',
    essential: true,
    sourcePages: [3],
    evidence: null,
    verification: 'verified',
    ...overrides
  }
}

export function newQuestion(docId: DocId, overrides: Partial<NewQuestion> = {}): NewQuestion {
  return {
    docId,
    topicId: null,
    type: 'mcq',
    stem: 'Which window has the lowest loss?',
    options: ['850 nm', '1310 nm', '1550 nm'],
    answer: { type: 'mcq', correctIndex: 2 },
    explanation: 'Silica has minimum attenuation near 1550 nm.',
    optionRationales: null,
    difficulty: 2,
    sourcePages: [3],
    evidence: null,
    verification: 'verified',
    fromBook: false,
    ...overrides
  }
}
