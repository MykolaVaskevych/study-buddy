import { rm } from 'node:fs/promises'
import type { CourseId, PortalAgentState, PortalState } from '@shared/domain'
import { normaliseAddress } from '../portal/policy'
import { allowedClick, describeSnapshot } from '../portal/snapshot'
import { createPortalWatchChecker } from './portal-watches'
import { requireCourse } from './courses'
import { messageOf } from './errors'
import type { Handlers, PipelineDeps, PortalNav } from './types'
import type { UsageLedger } from './usage'
import { ServiceError } from './types'

type PortalChannels =
  | 'portal.watch'
  | 'portal.unwatch'
  | 'portal.watches'
  | 'portal.open'
  | 'portal.close'
  | 'portal.setBounds'
  | 'portal.setCourse'
  | 'portal.navigate'
  | 'portal.go'
  | 'portal.state'
  | 'portal.signOut'
  | 'portal.agentStart'
  | 'portal.agentStop'
  | 'portal.agentState'

/** Clicks per "Get files with AI" run: a module of a dozen topics, each opened and downloaded. */
export const AGENT_MAX_STEPS = 40
const AGENT_LOG_SIZE = 60
const DEFAULT_GOAL =
  'Download every course file (lecture notes, slides, handouts, labs) of the course shown, one file at a time.'

/**
 * The study-portal browser: downloads of study files go into the chosen course through the normal
 * import (PDF, PowerPoint, Word, Markdown…), each course remembers its last portal page, and
 * "Get files with AI" clicks through the portal to download a course's files.
 */
export function createPortal(
  deps: Pick<PipelineDeps, 'db' | 'emit' | 'portal' | 'now' | 'portalScheduler'>,
  services: { importFiles: Handlers['library.import']; ledger: UsageLedger }
): { handlers: Pick<Handlers, PortalChannels>; start(): void; stop(): Promise<void> } {
  const { db, portal } = deps
  const checker = createPortalWatchChecker(deps)
  let courseId: CourseId | null = null
  let agent: PortalAgentState = {
    status: 'idle',
    step: 0,
    maxSteps: AGENT_MAX_STEPS,
    log: [],
    downloaded: []
  }
  let stopAgent: AbortController | null = null
  const publish = (next: Partial<PortalAgentState>): void => {
    agent = { ...agent, ...next }
    deps.emit('portal.agent', agent)
  }
  const note = (kind: PortalAgentState['log'][number]['kind'], text: string): void =>
    publish({ log: [...agent.log, { at: deps.now().toISOString(), kind, text }].slice(-AGENT_LOG_SIZE) })
  // One import at a time: conversions are heavy, and a run without a course fills the first file's.
  let importing: Promise<void> = Promise.resolve()
  const state = (nav: PortalNav = portal.state()): PortalState => ({ ...nav, courseId })

  portal.onChange((nav) => {
    if (courseId !== null && nav.url !== null && !nav.loading && db.courses.get(courseId)) {
      db.courses.setPortalUrl(courseId, nav.url)
    }
    deps.emit('portal.changed', state(nav))
  })

  portal.onDownload((file) => {
    if (file.kind === 'saved') {
      deps.emit('portal.downloaded', {
        fileName: file.fileName,
        courseId: null,
        docIds: [],
        error: 'Not a study file Study Buddy can read; saved to your Downloads folder'
      })
      return
    }
    if (agent.status === 'running') {
      publish({ downloaded: [...agent.downloaded, file.fileName] })
      note('file', `Downloaded ${file.fileName}`)
    }
    importing = importing.then(async () => {
      const target = courseId !== null && db.courses.get(courseId) ? courseId : null
      try {
        const docs = await services.importFiles({ paths: [file.path], courseId: target })
        // An AI run without a chosen course keeps every file in the first file's new course.
        const first = docs[0]
        if (target === null && agent.status === 'running' && first) {
          courseId = db.courses.list().find((c) => c.docIds.includes(first.id))?.id ?? null
          deps.emit('portal.changed', state())
        }
        deps.emit('portal.downloaded', {
          fileName: file.fileName,
          courseId: target ?? courseId,
          docIds: docs.map((d) => d.id),
          error: null
        })
      } catch (err) {
        deps.emit('portal.downloaded', {
          fileName: file.fileName,
          courseId: target,
          docIds: [],
          error: messageOf(err)
        })
      } finally {
        // The library keeps its own copy.
        await rm(file.path, { force: true }).catch(() => undefined)
      }
    })
  })

  /**
   * The AI's loop: snapshot the page, ask for up to five clicks, check each against the guardrails
   * (only listed elements, nothing that submits or deletes, never off the portal's site), press them,
   * and let the page settle. A click that opens another page ends the batch.
   */
  async function runAgent(goal: string, signal: AbortSignal): Promise<void> {
    const history: string[] = []
    for (let step = 1; step <= AGENT_MAX_STEPS; step++) {
      if (signal.aborted) return
      publish({ step })
      await portal.settle()
      const page = await portal.snapshot()
      if (!page) throw new ServiceError('validation', 'No page is open in the portal')
      const decision = await services.ledger.run(null, (ai) =>
        ai.portalStep({
          goal,
          page: describeSnapshot(page),
          history: history.slice(-15),
          downloaded: agent.downloaded,
          step,
          maxSteps: AGENT_MAX_STEPS,
          signal
        })
      )
      if (signal.aborted) return
      if (decision.thought.trim()) note('think', decision.thought.trim())
      for (const action of decision.actions) {
        if (signal.aborted) return
        if (action.type === 'back') {
          portal.go('back')
          history.push('back')
          note('click', 'Back')
          break
        }
        const el = page.elements.find((e) => e.id === action.element)
        if (!el) {
          history.push(`click ${String(action.element)}: no such element`)
          note('skip', `There is no element ${String(action.element)} on this page`)
          continue
        }
        const allowed = allowedClick(el, page.url)
        if (!allowed.ok) {
          history.push(`click [${el.id}] ${el.label}: refused, ${allowed.reason}`)
          note('skip', `Did not press “${el.label}”: ${allowed.reason}`)
          continue
        }
        const before = portal.state().url
        const pressed = await portal.click(el.id)
        history.push(`click [${el.id}] ${el.label}${pressed ? '' : ' (it was gone)'}`)
        note('click', action.why.trim() ? `${el.label}: ${action.why.trim()}` : el.label)
        await portal.settle()
        if (!pressed || portal.state().url !== before) break
      }
      if (decision.done) {
        note('done', decision.summary.trim() || 'Finished.')
        return
      }
    }
    note('done', `Stopped after ${AGENT_MAX_STEPS} steps; run it again to continue.`)
  }

  const setCourse = (id: CourseId | null): void => {
    courseId = id === null ? null : requireCourse(db, id)
  }

  return {
    start: checker.start,
    async stop() {
      stopAgent?.abort()
      await checker.stop()
    },
    handlers: {
      'portal.watch': async ({ courseId: id, url }) => {
        requireCourse(db, id)
        const address = normaliseAddress(url)
        if (address === null) throw new ServiceError('validation', 'Choose a web page to watch')
        return db.portalWatches.create(
          {
            courseId: id,
            url: address,
            title: portal.state().url === address ? portal.state().title : address
          },
          deps.now().toISOString()
        )
      },
      'portal.unwatch': async ({ watchId }) => {
        db.portalWatches.remove(watchId)
        return { ok: true }
      },
      'portal.watches': async () => db.portalWatches.list(),
      'portal.open': async ({ bounds, courseId: id }) => {
        setCourse(id)
        portal.show(bounds)
        const home = id === null ? null : (db.courses.get(id)?.portalUrl ?? null)
        if (portal.state().url === null && home !== null) portal.navigate(home)
        return state()
      },
      'portal.close': async () => {
        portal.hide()
        return { ok: true }
      },
      'portal.setBounds': async ({ bounds }) => {
        portal.setBounds(bounds)
        return { ok: true }
      },
      'portal.setCourse': async ({ courseId: id }) => {
        setCourse(id)
        return state()
      },
      'portal.navigate': async ({ url }) => {
        const address = normaliseAddress(url)
        if (address === null) throw new ServiceError('validation', `“${url}” is not a web address`)
        portal.navigate(address)
        return state()
      },
      'portal.go': async ({ action }) => {
        portal.go(action)
        return state()
      },
      'portal.state': async () => state(),
      'portal.signOut': async () => {
        await portal.signOut()
        return { ok: true }
      },
      'portal.agentStart': async ({ goal }) => {
        if (agent.status === 'running') return agent
        if (portal.state().url === null)
          throw new ServiceError('validation', 'Open your portal on a course page first')
        const controller = new AbortController()
        stopAgent = controller
        publish({ status: 'running', step: 0, log: [], downloaded: [] })
        runAgent(goal ?? DEFAULT_GOAL, controller.signal).then(
          () => publish({ status: controller.signal.aborted ? 'stopped' : 'done' }),
          (err: unknown) => {
            if (controller.signal.aborted) publish({ status: 'stopped' })
            else {
              note('error', messageOf(err))
              publish({ status: 'failed' })
            }
          }
        )
        return agent
      },
      'portal.agentStop': async () => {
        stopAgent?.abort()
        if (agent.status === 'running') {
          note('done', 'Stopped.')
          publish({ status: 'stopped' })
        }
        return agent
      },
      'portal.agentState': async () => agent
    }
  }
}
