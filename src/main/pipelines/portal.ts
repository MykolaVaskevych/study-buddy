import { rm } from 'node:fs/promises'
import type { CourseId, PortalState } from '@shared/domain'
import { normaliseAddress } from '../portal/policy'
import { requireCourse } from './courses'
import { messageOf } from './errors'
import type { Handlers, PipelineDeps, PortalNav } from './types'
import { ServiceError } from './types'

type PortalChannels =
  | 'portal.open'
  | 'portal.close'
  | 'portal.setBounds'
  | 'portal.setCourse'
  | 'portal.navigate'
  | 'portal.go'
  | 'portal.state'
  | 'portal.signOut'

/**
 * The study-portal browser: downloads of study files go into the chosen course through the normal
 * import (PDF, PowerPoint, Word…), and each course remembers its last portal page.
 */
export function createPortal(
  deps: Pick<PipelineDeps, 'db' | 'emit' | 'portal'>,
  services: { importFiles: Handlers['library.import'] }
): { handlers: Pick<Handlers, PortalChannels> } {
  const { db, portal } = deps
  let courseId: CourseId | null = null
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
    const target = courseId !== null && db.courses.get(courseId) ? courseId : null
    void services
      .importFiles({ paths: [file.path], courseId: target })
      .then(
        (docs) =>
          deps.emit('portal.downloaded', {
            fileName: file.fileName,
            courseId: target,
            docIds: docs.map((d) => d.id),
            error: null
          }),
        (err: unknown) =>
          deps.emit('portal.downloaded', {
            fileName: file.fileName,
            courseId: target,
            docIds: [],
            error: messageOf(err)
          })
      )
      // The library keeps its own copy.
      .finally(() => void rm(file.path, { force: true }).catch(() => undefined))
  })

  const setCourse = (id: CourseId | null): void => {
    courseId = id === null ? null : requireCourse(db, id)
  }

  return {
    handlers: {
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
      }
    }
  }
}
