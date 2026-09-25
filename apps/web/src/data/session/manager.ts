// Session manager: resolves a project id to a LOCAL or CLOUD session, ref-counts sessions (one per
// project per tab) and keeps them alive briefly after the last release (StrictMode / quick re-open).
import type { EditorUser } from '@cadsandbox/render'
import type { ProjectDTO, ProjectRole } from '@cadsandbox/shared'
import type { ProjectSession } from '../types'
import { api } from '../api/endpoints'
import { isApiError } from '../api/client'
import { getLocalProject } from '../local/projects'
import { cacheCloudProjects, getCachedCloudProject } from '../cloud-cache'
import { ProjectSessionImpl } from './session'

const SESSION_LINGER_MS = 3000

export type UnavailableReason = 'not_found' | 'forbidden' | 'unauthorized' | 'offline' | 'trashed'

export class ProjectUnavailableError extends Error {
  constructor(readonly reason: UnavailableReason) {
    super(
      {
        not_found: 'This project does not exist or was deleted.',
        forbidden: 'You do not have access to this project.',
        unauthorized: 'Sign in to open this project.',
        offline: 'This project is not available offline on this device.',
        trashed: 'This project is in the trash. Restore it to open it again.',
      }[reason],
    )
    this.name = 'ProjectUnavailableError'
  }
}

export interface OpenOptions {
  user: EditorUser
  shareToken?: string | null
}

interface Entry {
  session: ProjectSessionImpl
  refs: number
  linger: ReturnType<typeof setTimeout> | null
  /** `session.ready` rejected (e.g. access denied): never hand this session out again. */
  failed: boolean
}

const entries = new Map<string, Entry>()
const opening = new Map<string, Promise<Entry>>()

async function resolveCloud(projectId: string, shareToken: string | null): Promise<{ project: ProjectDTO; role: ProjectRole }> {
  try {
    const project = await api.projects.get(projectId, shareToken)
    // Only the owner still sees a trashed project, and its documents refuse collab connections.
    if (project.deletedAt) throw new ProjectUnavailableError('trashed')
    void cacheCloudProjects([project])
    return { project, role: project.role }
  } catch (err) {
    if (isApiError(err) && err.isNetwork) {
      const cached = await getCachedCloudProject(projectId)
      if (cached) return { project: cached, role: cached.role }
      throw new ProjectUnavailableError('offline')
    }
    if (isApiError(err)) {
      if (err.status === 401) throw new ProjectUnavailableError('unauthorized')
      if (err.status === 403) throw new ProjectUnavailableError('forbidden')
      if (err.status === 404) throw new ProjectUnavailableError('not_found')
    }
    throw err
  }
}

async function open(projectId: string, opts: OpenOptions): Promise<Entry> {
  const local = await getLocalProject(projectId)
  let session: ProjectSessionImpl
  const onClose = () => {
    const e = entries.get(projectId)
    if (e?.session === session) entries.delete(projectId)
  }
  if (local) {
    session = new ProjectSessionImpl({ projectId, mode: 'local', role: 'owner', project: null, user: opts.user, onClose })
  } else {
    const { project, role } = await resolveCloud(projectId, opts.shareToken ?? null)
    session = new ProjectSessionImpl({ projectId, mode: 'cloud', role, project, user: opts.user, shareToken: opts.shareToken, onClose })
  }
  const entry: Entry = { session, refs: 0, linger: null, failed: false }
  session.ready.catch(() => {
    entry.failed = true
  })
  entries.set(projectId, entry)
  return entry
}

/** Open (or reuse) the session of a project. Call `release()` when done. */
export async function acquireSession(projectId: string, opts: OpenOptions): Promise<{ session: ProjectSession; release: () => void }> {
  let entry = entries.get(projectId)
  // A session that failed to open (e.g. access denied) is still lingering after its error was shown:
  // "Retry" must start over with fresh metadata and connections instead of the same rejected promise.
  if (entry?.failed && !entry.session.isClosed) {
    if (entry.linger) clearTimeout(entry.linger)
    entry.session.close()
    entry = undefined
  }
  if (!entry || entry.session.isClosed) {
    let p = opening.get(projectId)
    if (!p) {
      p = open(projectId, opts).finally(() => opening.delete(projectId))
      opening.set(projectId, p)
    }
    entry = await p
  }
  const e = entry
  if (e.linger) {
    clearTimeout(e.linger)
    e.linger = null
  }
  e.refs++
  let released = false
  return {
    session: e.session,
    release: () => {
      if (released) return
      released = true
      e.refs--
      if (e.refs > 0) return
      e.linger = setTimeout(() => {
        if (e.refs === 0) e.session.close()
      }, SESSION_LINGER_MS)
    },
  }
}

/** Close a project's session immediately (e.g. before deleting or uploading it). */
export function closeSession(projectId: string): void {
  const e = entries.get(projectId)
  if (!e) return
  if (e.linger) clearTimeout(e.linger)
  e.session.close()
  entries.delete(projectId)
}

/** Close every open session (sign-out: providers and IndexedDB handles must be released first). */
export function closeAllSessions(): void {
  for (const id of [...entries.keys()]) closeSession(id)
}

export function isSessionOpen(projectId: string): boolean {
  const e = entries.get(projectId)
  return !!e && !e.session.isClosed
}
