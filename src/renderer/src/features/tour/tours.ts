/**
 * Guided tours, one per screen. Steps point at elements marked with data-tour="…" (or another
 * selector). `optional` steps are skipped when their element is not on screen (e.g. no books yet).
 */
export type TourId = 'library' | 'book' | 'planner' | 'review' | 'quiz' | 'overview' | 'studybook'

export interface TourStep {
  /** CSS selector of the element to highlight; omit for a centred card. */
  target?: string
  title: string
  body: string
  optional?: boolean
}

export const tours: Record<TourId, TourStep[]> = {
  library: [
    {
      title: 'Welcome to Study Buddy',
      body: 'It turns your lecture PDFs into an exam plan you can finish: notes, quick tests, flashcards and a schedule that skips what isn’t worth your time. This tour takes a minute; replay it any time with the ? button.'
    },
    {
      target: '[data-tour="import"]',
      title: 'Add your PDFs',
      body: 'Import PDFs here, or drop them anywhere on the window. The AI reads every page in the background, slides and formulas included. You can start reading straight away.',
      optional: true
    },
    {
      target: '[data-tour="book-card"]',
      title: 'Your books',
      body: 'Each book shows how much the AI has read, your mastery, cards due and the exam countdown. Click a book to open it, or “AI status” to see what is prepared.',
      optional: true
    },
    {
      target: '[data-tour="panic"]',
      title: 'Exam tomorrow? Don’t panic',
      body: 'The red button is a 30-minute cram: the flashcards that matter most for the exam, then a few exam-style questions with the answers explained. Then sleep.',
      optional: true
    },
    {
      target: '[data-tour="today"]',
      title: 'Today',
      body: 'Once a plan is saved, today’s sessions appear here: what to learn, check and review. Press Start and go.',
      optional: true
    },
    {
      target: '[data-tour="nav-/planner"]',
      title: 'Exam planner',
      body: 'Set your exam date and the hours you have. The planner picks what to learn fully, what to learn only at core level, and what to skip.'
    },
    {
      target: '[data-tour="nav-/review"]',
      title: 'Daily review',
      body: 'Flashcards come back here on a spaced-repetition schedule timed to your exam. A few minutes a day keeps everything fresh.'
    },
    {
      target: '[data-tour="provider-switch"]',
      title: 'Which AI does the work',
      body: 'Your Claude subscription, an Anthropic API key, or a free model on this computer (Ollama, LM Studio). Switch here in one click, for example when the subscription hits its limit. Sign-in and setup live in Settings.',
      optional: true
    },
    {
      target: '[data-tour="help"]',
      title: 'Help is always here',
      body: 'Every screen has its own short tour. Press ? whenever you are unsure what to do.'
    }
  ],
  book: [
    {
      target: '[data-tour="course-files"]',
      title: 'Courses and their files',
      body: 'A course keeps all the files of one subject together: slides, notes, past papers. Drag files to reorder them or into another course, drop files from your desktop onto a course to add them, and double-click (or F2) to rename. The ⋯ menu has the rest.',
      optional: true
    },
    {
      target: '[data-tour="course-map"]',
      title: 'Course map',
      body: 'The book’s topics with your mastery. Click a topic to jump to it. It fills in once the AI has read the book.',
      optional: true
    },
    {
      target: '[data-tour="reader"]',
      title: 'Read',
      body: 'Read your PDF here. Keys: j / k for next / previous page, Ctrl + / − to zoom.'
    },
    {
      target: '[role="tab"][id$="-tab-notes"]',
      title: 'Notes for this page',
      body: 'Summary, key points, concepts and formulas (with every symbol explained) for the page you are on. They follow you as you scroll.'
    },
    {
      target: '[role="tab"][id$="-tab-test"]',
      title: 'Test me',
      body: 'The core habit: read a page, then press Test me for 3–5 quick questions on exactly that page. Wrong answers point you back to the right spot.'
    },
    {
      target: '[role="tab"][id$="-tab-cards"]',
      title: 'Flashcards',
      body: 'Make cards for this page or topic: Essentials (must-know) or the full deck. They go into your daily review.'
    },
    {
      target: '[role="tab"][id$="-tab-chat"]',
      title: 'Ask the tutor',
      body: 'Ask anything about the book, or press Explain simply / Exam answer / Worked example for this page. Answers cite pages you can click.'
    },
    {
      target: '[data-tour="bookmark"]',
      title: 'Bookmarks and your notes',
      body: 'Press b (or this button) to bookmark a page. Your own notes for a page go at the top of the Notes tab. Both are listed above the course map.'
    },
    {
      target: '[data-tour="study-tools"]',
      title: 'Overview, study book, quiz, plan, cheat sheet',
      body: 'What the AI has prepared (with “Prepare everything” and progress resets), an AI-written study book, topic quizzes and mock exams, your exam plan, and a printable cheat sheet.'
    }
  ],
  studybook: [
    {
      target: '[data-tour="studybook-toc"]',
      title: 'Your study book',
      body: 'One chapter per topic, written from your slides: the idea in plain words, every formula with its symbols, a worked example, exam traps and Try-it exercises. Citations jump to the slide.',
      optional: true
    },
    {
      target: '[data-tour="write-all"]',
      title: 'Write it',
      body: 'Write all missing chapters (one AI request each), or one at a time with the button under each topic. Print / PDF gives you a paper copy.'
    }
  ],
  overview: [
    {
      target: '[data-tour="exam-profile"]',
      title: 'Tell it about your exam',
      body: 'Multiple choice, written or calculations? Formulas needed? Upload a past paper and it learns this for you. Flashcards, quick tests and the study book follow it.'
    },
    {
      target: '[data-tour="ai-status"]',
      title: 'What the AI has done',
      body: 'A checklist of everything prepared for this book: pages read, course map, plan, flashcards and quick tests, plus what is running right now.'
    },
    {
      target: '[data-tour="prepare"]',
      title: 'Prepare everything',
      body: 'One click: read the whole book, build the course map, then make essentials flashcards for every topic you plan to study. Keep studying while it works.'
    },
    {
      target: '[data-tour="my-progress"]',
      title: 'Your progress',
      body: 'Pages read, reviews and quizzes, mastery per topic. Reset a topic or the whole book to start over; the AI-made material stays.'
    }
  ],
  planner: [
    {
      target: '[data-tour="plan-form"]',
      title: 'Your situation',
      body: 'Exam date, hours per day (or total hours) and the score you are aiming for. Everything below updates as you change these.'
    },
    {
      target: '[data-tour="plan-score"]',
      title: 'Expected score',
      body: 'What this plan should get you, against your target. If the target is out of reach, it says how much time you would need.'
    },
    {
      target: '[data-tour="triage"]',
      title: 'What to study',
      body: 'Each topic gets Full, Core (essentials only) or Skip, with the reason. Click a level to pin it yourself, or change a topic’s exam weight if you know better.',
      optional: true
    },
    {
      target: '[data-tour="past-papers"]',
      title: 'Past papers',
      body: 'Have past exams? Add the PDFs and topic weights are recalibrated from what was actually asked.',
      optional: true
    },
    {
      target: '[data-tour="schedule"]',
      title: 'Day by day',
      body: 'Your schedule until the exam: learn, check, review and mock exams near the end. Click a session to start it.',
      optional: true
    },
    {
      target: '[data-tour="save-plan"]',
      title: 'Save',
      body: 'Save the plan. It re-plans itself after your quizzes, so it always reflects what you actually know.',
      optional: true
    }
  ],
  review: [
    {
      target: '[data-tour="review-card"]',
      title: 'Recall, then flip',
      body: 'Read the question and answer it in your head, then press Space to flip the card.',
      optional: true
    },
    {
      target: '[data-tour="review-ratings"]',
      title: 'Be honest',
      body: '1 Again · 2 Hard · 3 Good · 4 Easy. The schedule adapts, and makes sure you see each card again before your exam.',
      optional: true
    },
    {
      target: '[data-tour="export-anki"]',
      title: 'Anki',
      body: 'Prefer Anki? Export your cards, math included.',
      optional: true
    }
  ],
  quiz: [
    {
      target: '[data-tour="quiz-setup"]',
      title: 'Build a quiz',
      body: 'Pick what to cover, how many questions and which types. Instant feedback is for learning; Exam mode with a timer is for practice under pressure.',
      optional: true
    }
  ]
}

/**
 * Stable identity of a step: its target (or title for centred steps). Rewording a step does not
 * make it "new"; adding one does, so returning users see it automatically.
 */
export function stepKey(tour: TourId, step: TourStep): string {
  return `${tour}:${step.target ?? `title:${step.title}`}`
}

/** Which tour belongs to a route (the ? button). */
export function tourForPath(pathname: string): TourId {
  if (/^\/book\/[^/]+\/plan/.test(pathname)) return 'planner'
  if (/^\/book\/[^/]+\/quiz/.test(pathname)) return 'quiz'
  if (/^\/book\/[^/]+\/overview/.test(pathname)) return 'overview'
  if (/^\/book\/[^/]+\/studybook/.test(pathname)) return 'studybook'
  if (/^\/book\/[^/]+\/?$/.test(pathname)) return 'book'
  if (pathname.startsWith('/review')) return 'review'
  return 'library'
}
