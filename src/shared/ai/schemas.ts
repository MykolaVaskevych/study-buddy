import { z } from 'zod'

/**
 * Schemas for model outputs (structured outputs). Rules so they work with every provider:
 *  - z.strictObject everywhere (additionalProperties: false)
 *  - every field required; use .nullable() instead of .optional()
 *  - no numeric/length constraints (clamp in code instead), no unions of objects
 * Page numbers in outputs are ABSOLUTE, read from the "SB-PAGE <n>" stamp on each chunk page.
 */

export const pageKindSchema = z.enum([
  'title',
  'toc',
  'content',
  'exercise',
  'answers',
  'references',
  'blank',
  'other'
])
export const importanceSchema = z.enum(['core', 'supporting', 'detail'])
export const examSignalSchema = z.enum([
  'quiz_slide',
  'exam_trap',
  'practice_exam',
  'formula_sheet',
  'worked_example',
  'slide_correction',
  'emphasis'
])

// ---------------------------------------------------------------- index pass (per chunk)

export const indexedPageSchema = z.strictObject({
  page: z.number().int(),
  kind: pageKindSchema,
  /** Worth generating study items from (false for title/toc/blank/reference pages). */
  teachable: z.boolean(),
  summary: z.string(),
  key_points: z.array(z.string()),
  concepts: z.array(
    z.strictObject({ term: z.string(), definition: z.string(), importance: importanceSchema })
  ),
  formulas: z.array(
    z.strictObject({
      latex: z.string(),
      meaning: z.string(),
      symbols: z.array(
        z.strictObject({ symbol: z.string(), meaning: z.string(), unit: z.string().nullable() })
      ),
      importance: importanceSchema
    })
  ),
  exercises: z.array(z.strictObject({ question: z.string(), answer: z.string().nullable() })),
  exam_signals: z.array(examSignalSchema)
})

export const indexChunkOutputSchema = z.strictObject({
  /** ISO 639-1 code of the document language, e.g. "en". */
  language: z.string(),
  pages: z.array(indexedPageSchema)
})
export type IndexChunkOutput = z.infer<typeof indexChunkOutputSchema>
export type IndexedPageOutput = z.infer<typeof indexedPageSchema>

// ---------------------------------------------------------------- course map + estimates

export const topicMapOutputSchema = z.strictObject({
  topics: z.array(
    z.strictObject({
      key: z.string(),
      parent_key: z.string().nullable(),
      title: z.string(),
      page_start: z.number().int(),
      page_end: z.number().int(),
      objectives: z.array(z.string()),
      difficulty: z.number().int(),
      exam_weight: z.number(),
      exam_weight_reasons: z.array(z.string()),
      core_fraction: z.number(),
      core_minutes: z.number(),
      full_minutes: z.number(),
      prerequisite_keys: z.array(z.string())
    })
  )
})
export type TopicMapOutput = z.infer<typeof topicMapOutputSchema>

// ---------------------------------------------------------------- flashcards

export const cardTypeSchema = z.enum(['basic', 'cloze', 'formula', 'contrast', 'why'])

export const cardsOutputSchema = z.strictObject({
  cards: z.array(
    z.strictObject({
      type: cardTypeSchema,
      front: z.string(),
      back: z.string(),
      essential: z.boolean(),
      source_pages: z.array(z.number().int()),
      /** Short verbatim quote (<= 25 words) from the source page supporting the card. */
      evidence: z.string()
    })
  )
})
export type CardsOutput = z.infer<typeof cardsOutputSchema>

// ---------------------------------------------------------------- questions (flattened answer fields)

export const questionTypeSchema = z.enum(['mcq', 'multi', 'tf', 'short', 'numeric'])

export const questionsOutputSchema = z.strictObject({
  questions: z.array(
    z.strictObject({
      type: questionTypeSchema,
      stem: z.string(),
      options: z.array(z.string()).nullable(),
      correct_index: z.number().int().nullable(),
      correct_indices: z.array(z.number().int()).nullable(),
      tf_answer: z.boolean().nullable(),
      model_answer: z.string().nullable(),
      rubric: z.array(z.string()).nullable(),
      numeric_value: z.number().nullable(),
      numeric_tolerance: z.number().nullable(),
      numeric_unit: z.string().nullable(),
      explanation: z.string(),
      option_rationales: z.array(z.string()).nullable(),
      difficulty: z.number().int(),
      source_pages: z.array(z.number().int()),
      evidence: z.string()
    })
  )
})
export type QuestionsOutput = z.infer<typeof questionsOutputSchema>

// ---------------------------------------------------------------- grading & verification

export const gradeOutputSchema = z.strictObject({
  score: z.number(),
  verdict: z.enum(['correct', 'partial', 'incorrect']),
  feedback: z.string(),
  missing_points: z.array(z.string())
})
export type GradeOutput = z.infer<typeof gradeOutputSchema>

/** Blind answers to generated questions; compared with the answer key in code. */
export const verifyOutputSchema = z.strictObject({
  answers: z.array(
    z.strictObject({
      id: z.string(),
      choice_index: z.number().int().nullable(),
      choice_indices: z.array(z.number().int()).nullable(),
      tf_answer: z.boolean().nullable(),
      numeric_value: z.number().nullable(),
      /** False if the source does not determine the answer. */
      answerable: z.boolean()
    })
  )
})
export type VerifyOutput = z.infer<typeof verifyOutputSchema>

// ---------------------------------------------------------------- past papers

/** Questions of a past exam paper mapped to course topics (keys given in the prompt). */
export const pastPaperOutputSchema = z.strictObject({
  questions: z.array(
    z.strictObject({
      summary: z.string(),
      /** Marks printed on the paper, else an estimate (1 per sub-question). */
      marks: z.number(),
      /** Key of the best matching topic, null if none fits. */
      topic_key: z.string().nullable(),
      /** mcq = choose among options (incl. true/false), written = explain in words, numeric = calculate. */
      format: z.enum(['mcq', 'written', 'numeric']),
      /** The question needs a formula (to calculate, or to know what it says). */
      uses_formula: z.boolean()
    })
  ),
  /** 1-2 sentences on the exam's style: what it tests and how (e.g. conceptual MCQs on trade-offs). */
  style_summary: z.string(),
  /** Whether the paper says a formula sheet is provided; null if it does not say. */
  formula_sheet: z.boolean().nullable(),
  /** Up to 5 representative questions copied verbatim (with their options for MCQs). */
  examples: z.array(z.string())
})
export type PastPaperOutput = z.infer<typeof pastPaperOutputSchema>

// ---------------------------------------------------------------- course and file names

export const namingOutputSchema = z.strictObject({
  /** The subject, e.g. "Optical Networks". */
  course_name: z.string(),
  /** One entry per file, by the index it was listed with. */
  files: z.array(z.strictObject({ index: z.number().int(), title: z.string() }))
})
export type NamingOutput = z.infer<typeof namingOutputSchema>

// ---------------------------------------------------------------- portal driver

export const portalStepSchema = z.strictObject({
  /** One or two sentences: what the page shows and what to do next. */
  thought: z.string(),
  /** 0–5 actions, run in order; the list ends early when a click opens another page. */
  actions: z.array(
    z.strictObject({
      type: z.enum(['click', 'back']),
      /** Element number from the snapshot (click only; null for back). */
      element: z.number().int().nullable(),
      why: z.string()
    })
  ),
  /** True when every course file found is downloaded or nothing more can be done. */
  done: z.boolean(),
  /** For the student, when done: what was downloaded and what was left out. */
  summary: z.string()
})
export type PortalStepOutput = z.infer<typeof portalStepSchema>

// ---------------------------------------------------------------- study book lessons

/** A teaching chapter for one topic, written from its pages. */
export const lessonOutputSchema = z.strictObject({
  sections: z.array(z.strictObject({ title: z.string(), markdown: z.string() })),
  exercises: z.array(z.strictObject({ question: z.string(), answer: z.string() }))
})
export type LessonOutput = z.infer<typeof lessonOutputSchema>
