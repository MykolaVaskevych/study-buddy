import type { JobContext } from '../jobs/types'
import { fatal, notFound } from './errors'
import { addEvidence, resolveTopic, topicForPages } from './learning'
import type { Material } from './material'
import { generateCardsPayload, parsePayload, type GenerateCardsPayload } from './payloads'
import { PRIORITY } from './priorities'
import { pagesIn, resolveJobScope, resolveScope, scopeKey, scopeLabel } from './scope'
import { defaultCardCount, distribute } from './selection'
import type { Handlers, PipelineDeps } from './types'
import type { UsageLedger } from './usage'

/**
 * Flashcards: generation as a background job (one call per window, cards stored as they arrive),
 * the rest maps onto the card repository and the deadline-aware SRS. Reviews feed topic mastery.
 */
export interface Cards {
  handlers: Pick<
    Handlers,
    | 'cards.generate'
    | 'cards.list'
    | 'cards.due'
    | 'cards.review'
    | 'cards.update'
    | 'cards.setStatus'
    | 'cards.stats'
  >
  runJob(payload: unknown, ctx: JobContext): Promise<void>
}

export function createCards(
  deps: Pick<PipelineDeps, 'db' | 'queue' | 'srs' | 'emit' | 'now'>,
  services: { ledger: UsageLedger; material: Material }
): Cards {
  const { db, queue } = deps
  const { ledger, material } = services
  const nowIso = (): string => deps.now().toISOString()

  return {
    async runJob(raw, ctx) {
      const p = parsePayload(generateCardsPayload, raw)
      if (!db.documents.get(p.scope.docId)) return
      const resolved = resolveJobScope(db, p.scope)
      const docId = resolved.doc.id
      const windows = material.teachable(docId, await material.windows(resolved, p.scope.kind === 'document'))
      if (windows.length === 0) throw fatal(`Nothing to make flashcards from in ${scopeLabel(resolved)}`)
      const counts =
        p.count === null
          ? windows.map((w) => defaultCardCount(pagesIn(w), p.essentialsOnly))
          : distribute(p.count, windows.map(pagesIn))
      let stored = 0
      for (const [i, window] of windows.entries()) {
        const count = counts[i] ?? 0
        if (count <= 0) continue
        ctx.progress(i / windows.length)
        const gen = await material.context(resolved.doc, window, ctx.signal)
        const drafts = await ledger.run(docId, (ai) =>
          ai.generateCards(gen, {
            count,
            essentialsOnly: p.essentialsOnly,
            existingFronts: db.cards.fronts(docId)
          })
        )
        if (drafts.length === 0 || !db.documents.get(docId)) continue
        db.cards.insertMany(
          drafts.map((d) => ({ ...d, docId, topicId: topicForPages(db, docId, d.sourcePages) })),
          nowIso()
        )
        stored += drafts.length
        // Per window, so a long document fills the deck while the job is still running.
        deps.emit('cards.changed', { docId })
      }
      if (stored === 0) throw fatal(`No new flashcards came back for ${scopeLabel(resolved)}`)
    },

    handlers: {
      'cards.generate': async ({ scope, essentialsOnly, count }) => {
        const resolved = resolveScope(db, scope)
        const job = queue.enqueue<GenerateCardsPayload>({
          kind: 'generate_cards',
          docId: scope.docId,
          payload: { scope, essentialsOnly, count },
          priority: PRIORITY.requested,
          dedupeKey: `cards:${scopeKey(scope)}:${essentialsOnly ? 'essentials' : 'full'}`,
          label: `${essentialsOnly ? 'Essential flashcards' : 'Flashcards'} for ${scopeLabel(resolved)}`
        })
        return { jobId: job.id }
      },

      'cards.list': async ({ scope, includeInactive }) => db.cards.list(scope, includeInactive),

      'cards.due': async ({ docId, limit }) => db.cards.due(docId, nowIso(), limit),

      'cards.review': async ({ cardId, rating, elapsedMs }) => {
        const card = db.cards.get(cardId)
        if (!card) throw notFound('Card', cardId)
        const now = nowIso()
        const examDate = db.plans.get(card.docId)?.input.examDate ?? null
        const srs = deps.srs.review(card.srs, rating, now, examDate)
        const updated = db.cards.saveReview(cardId, srs, { rating, reviewedAt: now, elapsedMs })
        // Good/Easy is a correct recall, Again a failed one; Hard says too little either way.
        if (rating >= 3) addEvidence(db, resolveTopic(db, card), true)
        else if (rating === 1) addEvidence(db, resolveTopic(db, card), false)
        return updated
      },

      'cards.update': async ({ cardId, front, back }) => db.cards.update(cardId, { front, back }),

      'cards.setStatus': async ({ cardId, status }) => db.cards.update(cardId, { status }),

      'cards.stats': async ({ docId }) => db.cards.stats(docId, nowIso())
    }
  }
}
