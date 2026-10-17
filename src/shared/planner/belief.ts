import type { MasteryBelief } from './types'

/**
 * Mastery beliefs: Beta(alpha, beta) over the probability of answering a topic's questions right.
 * A topic with no evidence has no belief (null). The first update starts from the uniform
 * Beta(1, 1), so alpha − 1 and beta − 1 are the observed correct and incorrect answers.
 */

const UNIFORM: MasteryBelief = { alpha: 1, beta: 1 }

const count = (x: number): number => (Number.isFinite(x) && x > 0 ? x : 0)

const isValid = (b: MasteryBelief): boolean =>
  Number.isFinite(b.alpha) && Number.isFinite(b.beta) && b.alpha >= 0 && b.beta >= 0 && b.alpha + b.beta > 0

/**
 * Adds quiz evidence: Beta(alpha + correct, beta + incorrect). A null belief starts from Beta(1, 1).
 * Counts may be fractional (partial credit). Negative or non-finite counts add nothing.
 */
export function updateBelief(
  belief: MasteryBelief | null,
  correct: number,
  incorrect: number
): MasteryBelief {
  const base = belief && isValid(belief) ? belief : UNIFORM
  return { alpha: base.alpha + count(correct), beta: base.beta + count(incorrect) }
}

/** Posterior mean alpha / (alpha + beta), or null when there is no (valid) belief. */
export function beliefMean(belief: MasteryBelief | null): number | null {
  if (!belief || !isValid(belief)) return null
  return belief.alpha / (belief.alpha + belief.beta)
}

/**
 * Accuracy expected after reaching a level whose default accuracy is `prior`, given quiz evidence.
 *
 * The default works as a prior worth `priorWeight` answers. The observed answers (the belief
 * without its Beta(1, 1) start) pull toward the measured rate. Evidence can only lift a level:
 * finishing a level is assumed to reach at least its default. Removing the uniform start keeps
 * this monotone. More correct answers never lower the result, and more wrong answers never raise it.
 */
export function levelAccuracy(prior: number, belief: MasteryBelief | null, priorWeight: number): number {
  if (!belief || !isValid(belief)) return prior
  const correct = Math.max(0, belief.alpha - 1)
  const incorrect = Math.max(0, belief.beta - 1)
  const n = correct + incorrect
  const k = Math.max(0, priorWeight)
  if (n <= 0 || k + n <= 0) return prior
  return Math.max(prior, (k * prior + correct) / (k + n))
}

/** Share of observed answers that were right (the Beta(1, 1) start removed), or null without answers. */
export function observedAccuracy(belief: MasteryBelief | null): number | null {
  if (!belief || !isValid(belief)) return null
  const correct = Math.max(0, belief.alpha - 1)
  const n = correct + Math.max(0, belief.beta - 1)
  return n > 0 ? correct / n : null
}
