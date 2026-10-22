import type { AiTask, Effort, ModelTier } from './provider'

/**
 * Which model does which job. Every AI call names its task; routing picks the tier (fast or smart
 * model of the provider in use) and the effort for it, so bulk work runs on the cheap model and the
 * strong one is kept for work where it shows. Pure data, shared by main and the settings screen.
 */

export type RoutedTask = Exclude<AiTask, 'health'>

export interface Route {
  tier: ModelTier
  effort: Effort
}

export type RoutingPreset = 'balanced' | 'economy' | 'quality'

/** Tasks in the order the settings screen lists them, with what they are for. */
export const ROUTED_TASKS: { task: RoutedTask; label: string; description: string }[] = [
  { task: 'index', label: 'Reading pages', description: 'Notes, concepts and formulas for every page' },
  { task: 'topics', label: 'Course map', description: 'Topics, exam weight and study time; once per book' },
  { task: 'cards', label: 'Flashcards', description: 'Cards from the pages, checked against the text' },
  { task: 'page_check', label: 'Test me', description: 'A few quick questions on the page you read' },
  {
    task: 'questions',
    label: 'Quizzes and mock exams',
    description: 'Exam-style questions with explanations'
  },
  {
    task: 'verify',
    label: 'Answer-key check',
    description: 'Answers every question blind to catch wrong keys'
  },
  { task: 'grade', label: 'Marking written answers', description: 'Grades short answers against the book' },
  { task: 'chat', label: 'Tutor', description: 'Answers questions about the book with page citations' },
  { task: 'lesson', label: 'Study book', description: 'One chapter per topic' },
  { task: 'past_paper', label: 'Past papers', description: 'Maps past exam questions to topics' },
  { task: 'explain', label: 'Explanations', description: 'Explain simply, exam answer, worked example' },
  { task: 'naming', label: 'File names', description: 'Suggests names for courses and files' },
  { task: 'portal', label: 'Getting portal files', description: 'Clicks through the study portal' }
]

const fast = (effort: Effort = 'low'): Route => ({ tier: 'fast', effort })
const smart = (effort: Effort = 'medium'): Route => ({ tier: 'smart', effort })

export const ROUTING_PRESETS: Record<RoutingPreset, Record<RoutedTask, Route>> = {
  /**
   * The cheap model drafts in bulk (flashcards, quick page tests): the app checks every item against
   * the page text, and weak batches are redone on the strong model. The strong model keeps the jobs
   * where judgement shows: the course map, exam questions, the answer-key check, marking and teaching.
   */
  balanced: {
    index: fast(),
    topics: smart(),
    cards: fast('medium'),
    page_check: fast('medium'),
    questions: smart(),
    verify: smart('low'),
    grade: smart('low'),
    chat: smart('low'),
    lesson: smart(),
    past_paper: smart(),
    explain: smart('low'),
    naming: fast(),
    portal: fast()
  },
  /** Saves the most: only the course map stays on the strong model. */
  economy: {
    index: fast(),
    topics: smart('low'),
    cards: fast('medium'),
    page_check: fast('low'),
    questions: fast('medium'),
    verify: fast('low'),
    grade: fast('low'),
    chat: fast('low'),
    lesson: fast('medium'),
    past_paper: fast('medium'),
    explain: fast('low'),
    naming: fast(),
    portal: fast()
  },
  /** Everything that writes study material on the strong model (the app's behaviour before routing). */
  quality: {
    index: fast(),
    topics: smart(),
    cards: smart(),
    page_check: smart(),
    questions: smart(),
    verify: smart('low'),
    grade: smart('low'),
    chat: smart('low'),
    lesson: smart(),
    past_paper: smart(),
    explain: smart('low'),
    naming: fast(),
    portal: fast()
  }
}

export interface RoutingSettings {
  preset: RoutingPreset
  /** Tasks the student set differently from the preset. */
  overrides: ({ task: RoutedTask } & Route)[]
  /** Redo a weak batch (many cards failing the page check) once on the strong model. */
  escalate: boolean
}

export const DEFAULT_ROUTING: RoutingSettings = { preset: 'balanced', overrides: [], escalate: true }

/** The route of every task: the preset, with the student's overrides on top. */
export function resolveRoutes(routing: RoutingSettings): Record<RoutedTask, Route> {
  const routes = { ...ROUTING_PRESETS[routing.preset] }
  for (const o of routing.overrides) routes[o.task] = { tier: o.tier, effort: o.effort }
  return routes
}
