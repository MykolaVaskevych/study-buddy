import type { SessionKind, StudySession } from '@shared/planner'

/**
 * How each kind of study session looks and where "Start" takes the student.
 * Colours follow the pencil case: ink for learning, the green pen for checking yourself,
 * fountain-pen blue for spaced review, the red pen for mock exams.
 */
export const SESSION_KINDS: Record<SessionKind, { name: string; bar: string; soft: string }> = {
  learn: { name: 'Learn', bar: 'bg-ink', soft: 'bg-sunken' },
  check: { name: 'Check', bar: 'bg-ok', soft: 'bg-ok-soft' },
  review: { name: 'Review', bar: 'bg-accent', soft: 'bg-accent-soft' },
  mock: { name: 'Mock exam', bar: 'bg-redpen', soft: 'bg-redpen-soft' }
}

export const SESSION_ORDER: readonly SessionKind[] = ['learn', 'check', 'review', 'mock']

export interface SessionTarget {
  /** Router path with query. */
  to: string
  /** Study panel tab to open with the book (page checks open "Test me"). */
  studyTab: string | null
}

export const bookPath = (docId: string, page: number | null = null): string =>
  `/book/${encodeURIComponent(docId)}${page !== null ? `?page=${page}` : ''}`

export const planPath = (docId: string): string => `/book/${encodeURIComponent(docId)}/plan`

/**
 * Where a session starts: learning opens the book at the topic's first page, a check opens the same
 * page with "Test me", review goes to the due cards, a mock exam to the book's mock quiz.
 */
export function sessionTarget(
  session: StudySession,
  docId: string,
  pageOf: (topicId: string) => number | null
): SessionTarget {
  const page = session.topicId !== null ? pageOf(session.topicId) : null
  switch (session.kind) {
    case 'learn':
      return { to: bookPath(docId, page), studyTab: null }
    case 'check':
      return { to: bookPath(docId, page), studyTab: 'test' }
    case 'review':
      return { to: '/review', studyTab: null }
    case 'mock':
      return { to: `/book/${encodeURIComponent(docId)}/quiz?mode=mock`, studyTab: null }
  }
}
