import { CORE_PRINCIPLES, PDF_PRINCIPLES } from './common'

/**
 * One system prompt for every generation call over chunk PDFs (cards, questions, page checks
 * and the blind verification pass). Sharing it keeps the request prefix (system + documents)
 * identical across those calls, so a verify pass right after generation reads the PDFs from the
 * prompt cache instead of paying for them again. Task rules live in the user text part.
 */
export const STUDY_SYSTEM = `${CORE_PRINCIPLES}

${PDF_PRINCIPLES}

You will receive chunk PDFs, a task with its parameters, a page manifest and often index notes from a first pass. Work only on the focus pages named in the task, follow the task's rules exactly, and fill every field of the output schema (null where a field does not apply).`
