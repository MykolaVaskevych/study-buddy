/**
 * Exact solver for exam triage: a multiple-choice knapsack with prerequisite constraints.
 *
 * Knapsack (one DP pass, O(topics × slots × 3))
 *   Each topic is a group with up to three options (full, core, skip), each with a slot cost and a
 *   value (expected marks). dp[b] is the best plan over the topics seen so far that uses at most b
 *   slots. "Best" is lexicographic: most marks, then fewest slots, then fewest topics touched
 *   (topics with minutes > 0). Values are quantised to 1e-9 marks, so comparisons are exact and the
 *   plan is deterministic. Exact ties keep the higher level, so a free "full" beats a free "skip".
 *   - max_score: the plan at b = budget.
 *   - min_time:  the smallest b whose optimum reaches the target. Among plans of that length it
 *                takes the one with the most marks. If no b within the budget reaches the target,
 *                it falls back to max_score.
 *
 * Prerequisites (branch and bound around the DP)
 *   Rule: if topic i is studied (core/full), each enforced prerequisite p is studied too.
 *   Each topic keeps one prerequisite edge as a forest (chapter chains). The DP enforces those
 *   edges exactly by skipping whole subtrees in preorder. Without the other edges it is a
 *   relaxation, and its optimum bounds every plan that obeys the full rule.
 *   If the relaxed plan breaks the rule at (i, p), we branch on p:
 *     A  p must be studied. Propagated: p's prerequisites must be studied too.
 *     B  p is skipped. Propagated: every topic that depends on p, directly or not, is skipped.
 *   Every valid plan lies in exactly one branch, so the search is exact. Branch A runs first; this
 *   is the classic "force the prerequisite and re-solve" heuristic, which gives a good plan early.
 *   Nodes whose bound cannot beat that plan are pruned. Cycles in the prerequisite graph are fine,
 *   because both branches only ever shrink the allowed level sets. `maxNodes` caps pathological
 *   graphs. When the cap is hit, the best valid plan found so far is returned (`truncated`).
 *
 * This module knows nothing about topics or text; ./solver.ts maps the domain onto it.
 */
import type { PlanMode, StudyLevel } from './types'

/** Level indices used by the search. */
export const SKIP = 0
export const CORE = 1
export const FULL = 2
export const LEVELS: readonly StudyLevel[] = ['skip', 'core', 'full']
export const levelIndex = (level: StudyLevel): number =>
  level === 'skip' ? SKIP : level === 'core' ? CORE : FULL

/** Bit per level in an allowed-levels mask. */
export const LEVEL_BIT: readonly number[] = [1, 2, 4]
export const ALL_LEVELS = 7
const SKIP_BIT = 1
const STUDY_BITS = 6

/** Expected marks are compared in units of 1 / SCORE_SCALE. */
export const SCORE_SCALE = 1e9
/** A plan "reaches" the target if it is at most this far below it (absorbs rounding). */
export const REACH_TOLERANCE = 1e-6
const REACH_TOLERANCE_Q = Math.round(REACH_TOLERANCE * SCORE_SCALE)

export const quantise = (marks: number): number => Math.round(marks * SCORE_SCALE)

export interface SearchTopic {
  /** Slot cost per level index (skip, core, full). */
  slots: readonly [number, number, number]
  /** Quantised expected marks per level index. */
  value: readonly [number, number, number]
  /** Allowed levels (LEVEL_BIT mask); a user pin leaves a single bit. Must not be 0. */
  allowed: number
  /** Indices of enforced prerequisites. */
  prereqs: readonly number[]
}

export interface SearchProblem {
  topics: readonly SearchTopic[]
  budgetSlots: number
  mode: PlanMode
  /** Quantised target score. */
  targetValue: number
  maxNodes: number
}

export interface SearchResult {
  /** Level index per topic. */
  levels: number[]
  slots: number
  /** Quantised expected marks. */
  value: number
  reachedTarget: boolean
  /** True where the constraints, not the user, removed `skip` (the topic had to be studied). */
  required: boolean[]
  /** Least slots the user's pins and their prerequisites need. */
  mandatorySlots: number
  /** Budget the search ran with: max(budgetSlots, mandatorySlots). */
  effectiveBudgetSlots: number
  /** Relaxations solved. */
  nodes: number
  /** The node cap stopped the search before optimality was proven. */
  truncated: boolean
}

interface Relaxation {
  key: number[]
  levels: Uint8Array
  slots: number
  value: number
  reached: boolean
}

/** Lexicographic comparison of two keys of equal length; > 0 means `a` is better. */
function compareKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

const SKIP_SUBTREE = 3

/**
 * Spanning forest of the prerequisite graph: each topic keeps at most one prerequisite (its first
 * one that does not close a cycle) as its parent. Returned in DFS preorder, so every subtree is a
 * contiguous range [pos, end[pos]).
 */
function prerequisiteForest(prereqs: readonly (readonly number[])[]): { order: number[]; end: number[] } {
  const n = prereqs.length
  const root = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    let r = x
    while (root[r] !== r) r = root[r] ?? r
    return r
  }
  const children: number[][] = prereqs.map(() => [])
  const hasParent = new Array<boolean>(n).fill(false)
  for (let i = 0; i < n; i++) {
    for (const p of prereqs[i] ?? []) {
      if (find(p) === find(i)) continue
      root[find(i)] = find(p)
      children[p]?.push(i)
      hasParent[i] = true
      break
    }
  }
  const order: number[] = []
  const endOf = new Array<number>(n).fill(0)
  const visit = (start: number): void => {
    const stack: [number, number][] = [[start, 0]]
    order.push(start)
    while (stack.length > 0) {
      const top = stack[stack.length - 1]
      if (!top) break
      const [node, k] = top
      const kids = children[node] ?? []
      if (k < kids.length) {
        top[1] = k + 1
        const child = kids[k] ?? 0
        order.push(child)
        stack.push([child, 0])
      } else {
        endOf[node] = order.length
        stack.pop()
      }
    }
  }
  for (let i = 0; i < n; i++) if (!hasParent[i]) visit(i)
  return { order, end: order.map((node) => endOf[node] ?? 0) }
}

/**
 * The relaxation solved at every search node: the knapsack with the forest's prerequisite edges
 * enforced exactly. In preorder, a topic is either studied (move on to the next position) or skipped
 * together with its whole subtree (jump to the subtree's end), because everything below it depends on it.
 * Cost O(topics × slots × 3), like the plain knapsack, but it already respects every chapter chain,
 * so branch and bound only has to handle the remaining cross links. Tables are allocated once per search.
 */
class Dp {
  private readonly width: number
  private readonly order: number[]
  private readonly end: number[]
  private readonly v: Float64Array
  private readonly m: Int32Array
  private readonly t: Int32Array
  private readonly choice: Uint8Array
  private readonly skipValue: Float64Array
  private readonly pinned: Int32Array

  constructor(
    private readonly topics: readonly SearchTopic[],
    prereqs: readonly (readonly number[])[],
    budget: number,
    private readonly mode: PlanMode,
    private readonly target: number
  ) {
    const n = topics.length
    this.width = budget + 1
    ;({ order: this.order, end: this.end } = prerequisiteForest(prereqs))
    this.v = new Float64Array((n + 1) * this.width)
    this.m = new Int32Array((n + 1) * this.width)
    this.t = new Int32Array((n + 1) * this.width)
    this.choice = new Uint8Array(n * this.width)
    this.skipValue = new Float64Array(n + 1)
    this.pinned = new Int32Array(n + 1)
  }

  /** Best plan (by the mode's key) using only the levels allowed in `masks`; null if none fits. */
  relax(masks: Uint8Array): Relaxation | null {
    const { topics, width: W, order, end, v, m, t, choice, skipValue, pinned } = this
    const n = topics.length
    // Prefix sums over preorder positions: skip value, and topics that may not be skipped.
    for (let pos = 0; pos < n; pos++) {
      const node = order[pos] ?? 0
      const mask = masks[node] ?? 0
      skipValue[pos + 1] = (skipValue[pos] ?? 0) + (topics[node]?.value[SKIP] ?? 0)
      pinned[pos + 1] = (pinned[pos] ?? 0) + ((mask & SKIP_BIT) === 0 ? 1 : 0)
    }
    v.fill(0, n * W, (n + 1) * W)
    m.fill(0, n * W, (n + 1) * W)
    t.fill(0, n * W, (n + 1) * W)

    for (let pos = n - 1; pos >= 0; pos--) {
      const node = order[pos] ?? 0
      const topic = topics[node]
      if (!topic) continue
      const mask = masks[node] ?? 0
      const stop = end[pos] ?? pos + 1
      const canSkip = (pinned[stop] ?? 0) - (pinned[pos] ?? 0) === 0
      const sv = (skipValue[stop] ?? 0) - (skipValue[pos] ?? 0)
      const fullOk = (mask & (LEVEL_BIT[FULL] ?? 0)) !== 0
      const coreOk = (mask & (LEVEL_BIT[CORE] ?? 0)) !== 0
      const fs = topic.slots[FULL]
      const fv = topic.value[FULL]
      const cs = topic.slots[CORE]
      const cvl = topic.value[CORE]
      const row = pos * W
      const next = (pos + 1) * W
      const jump = stop * W
      for (let b = 0; b < W; b++) {
        let bv = -1
        let bm = 0
        let bt = 0
        let bo = 255
        // Order full, core, skip: on an exact tie the first (higher level) is kept.
        if (fullOk && fs <= b) {
          const q = next + b - fs
          const prev = v[q] ?? -1
          if (prev >= 0) {
            bv = prev + fv
            bm = (m[q] ?? 0) + fs
            bt = (t[q] ?? 0) + (fs > 0 ? 1 : 0)
            bo = FULL
          }
        }
        if (coreOk && cs <= b) {
          const q = next + b - cs
          const prev = v[q] ?? -1
          if (prev >= 0) {
            const cv = prev + cvl
            const cm = (m[q] ?? 0) + cs
            const ct = (t[q] ?? 0) + (cs > 0 ? 1 : 0)
            if (cv > bv || (cv === bv && (cm < bm || (cm === bm && ct < bt)))) {
              bv = cv
              bm = cm
              bt = ct
              bo = CORE
            }
          }
        }
        if (canSkip) {
          const q = jump + b
          const prev = v[q] ?? -1
          if (prev >= 0) {
            const sv2 = prev + sv
            const sm = m[q] ?? 0
            const st = t[q] ?? 0
            if (sv2 > bv || (sv2 === bv && (sm < bm || (sm === bm && st < bt)))) {
              bv = sv2
              bm = sm
              bt = st
              bo = SKIP_SUBTREE
            }
          }
        }
        v[row + b] = bv
        m[row + b] = bm
        t[row + b] = bt
        choice[row + b] = bo
      }
    }

    let at = W - 1
    let reached = false
    if (this.mode === 'min_time') {
      for (let b = 0; b < W; b++) {
        if ((v[b] ?? -1) >= this.target - REACH_TOLERANCE_Q) {
          at = b
          reached = true
          break
        }
      }
    }
    const value = v[at] ?? -1
    if (value < 0) return null
    const slots = m[at] ?? 0
    const touched = t[at] ?? 0
    if (this.mode === 'max_score') reached = value >= this.target - REACH_TOLERANCE_Q

    const levels = new Uint8Array(n)
    let b = at
    let pos = 0
    while (pos < n) {
      const node = order[pos] ?? 0
      const c = choice[pos * W + b] ?? SKIP_SUBTREE
      if (c === SKIP_SUBTREE) {
        const stop = end[pos] ?? pos + 1
        for (let q = pos; q < stop; q++) levels[order[q] ?? 0] = SKIP
        pos = stop
      } else {
        levels[node] = c
        b -= topics[node]?.slots[c as 0 | 1 | 2] ?? 0
        pos++
      }
    }

    let key: number[]
    if (this.mode === 'max_score') key = [value, -slots, -touched]
    else if (reached) key = [1, -slots, value, -touched]
    else key = [0, value, -slots, -touched]
    return { key, levels, slots, value, reached }
  }
}

/** Removes `skip` from `start` and, transitively, from its prerequisites. False if that empties a mask. */
function requireStudy(masks: Uint8Array, start: number, prereqs: readonly (readonly number[])[]): boolean {
  const stack = [start]
  while (stack.length > 0) {
    const x = stack.pop() ?? 0
    const m = masks[x] ?? 0
    if ((m & STUDY_BITS) === 0) return false
    if ((m & SKIP_BIT) !== 0) {
      masks[x] = m & ~SKIP_BIT
      for (const p of prereqs[x] ?? []) stack.push(p)
    }
  }
  return true
}

/** Forces `start` and, transitively, everything depending on it to `skip`. False if that empties a mask. */
function requireSkip(masks: Uint8Array, start: number, dependents: readonly (readonly number[])[]): boolean {
  const stack = [start]
  while (stack.length > 0) {
    const x = stack.pop() ?? 0
    const m = masks[x] ?? 0
    if ((m & SKIP_BIT) === 0) return false
    if ((m & STUDY_BITS) !== 0) {
      masks[x] = SKIP_BIT
      for (const d of dependents[x] ?? []) stack.push(d)
    }
  }
  return true
}

/** First prerequisite (in topic order) that the plan skips although a studied topic needs it, or -1. */
function firstViolation(levels: Uint8Array, prereqs: readonly (readonly number[])[]): number {
  for (let i = 0; i < levels.length; i++) {
    if (levels[i] === SKIP) continue
    for (const p of prereqs[i] ?? []) if (levels[p] === SKIP) return p
  }
  return -1
}

/** Solves the triage problem exactly (see the file comment). */
export function searchPlan(problem: SearchProblem): SearchResult {
  const { topics, mode, targetValue } = problem
  const n = topics.length
  const prereqs = topics.map((t) => t.prereqs)
  const dependents: number[][] = topics.map(() => [])
  prereqs.forEach((ps, i) => ps.forEach((p) => dependents[p]?.push(i)))

  // Root: the user's pins, plus "prerequisites of pinned studied topics must be studied".
  const root = Uint8Array.from(topics, (t) => t.allowed & ALL_LEVELS || ALL_LEVELS)
  for (let i = 0; i < n; i++) {
    if (((root[i] ?? 0) & SKIP_BIT) !== 0) continue
    // Cannot fail: only a user "skip" pin has no study bit, and those edges are not enforced.
    for (const p of prereqs[i] ?? []) requireStudy(root, p, prereqs)
  }

  // Least cost of any valid plan: pinned/required topics at their cheapest allowed level, the rest skipped.
  let mandatorySlots = 0
  for (let i = 0; i < n; i++) {
    let cheapest = Infinity
    for (let lv = SKIP; lv <= FULL; lv++) {
      if (((root[i] ?? 0) & (LEVEL_BIT[lv] ?? 0)) !== 0) {
        cheapest = Math.min(cheapest, topics[i]?.slots[lv as 0 | 1 | 2] ?? 0)
      }
    }
    mandatorySlots += Number.isFinite(cheapest) ? cheapest : 0
  }
  const budget = Math.max(0, Math.floor(problem.budgetSlots), mandatorySlots)
  const dp = new Dp(topics, prereqs, budget, mode, targetValue)

  interface Node {
    masks: Uint8Array
    bound: number[] | null
  }
  const stack: Node[] = [{ masks: root, bound: null }]
  let best: { relaxation: Relaxation; masks: Uint8Array } | null = null
  let nodes = 0
  let truncated = false

  while (stack.length > 0) {
    const node = stack.pop()
    if (!node) break
    if (best && node.bound && compareKeys(node.bound, best.relaxation.key) <= 0) continue
    if (best && nodes >= problem.maxNodes) {
      truncated = true
      break
    }
    const relaxation = dp.relax(node.masks)
    nodes++
    if (!relaxation) continue
    if (best && compareKeys(relaxation.key, best.relaxation.key) <= 0) continue

    const p = firstViolation(relaxation.levels, prereqs)
    if (p < 0) {
      best = { relaxation, masks: node.masks }
      continue
    }
    const skipChild = node.masks.slice()
    if (requireSkip(skipChild, p, dependents)) stack.push({ masks: skipChild, bound: relaxation.key })
    const studyChild = node.masks.slice()
    if (requireStudy(studyChild, p, prereqs)) stack.push({ masks: studyChild, bound: relaxation.key })
  }

  // The root always admits "pins + their prerequisites, everything else skipped" within `budget`,
  // and branch B never turns a feasible node infeasible, so a plan is always found.
  if (!best) throw new Error('searchPlan: no valid plan found (solver invariant broken)')

  const { relaxation, masks } = best
  return {
    levels: Array.from(relaxation.levels),
    slots: relaxation.slots,
    value: relaxation.value,
    reachedTarget: relaxation.reached,
    required: Array.from(
      masks,
      (m, i) => (m & SKIP_BIT) === 0 && ((topics[i]?.allowed ?? 0) & SKIP_BIT) !== 0
    ),
    mandatorySlots,
    effectiveBudgetSlots: budget,
    nodes,
    truncated
  }
}
