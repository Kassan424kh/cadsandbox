// Hono environment + request helpers (validation, session, guards, project access).
import type { Context } from 'hono'
import type { HttpBindings } from '@hono/node-server'
import type { z } from 'zod'
import { can, type ProjectAction, type SystemRole } from '@cadsandbox/shared'
import type { AuthSession } from '../auth/auth'
import type { Deps } from '../deps'
import { badRequest, forbidden, HttpError, notFound, rateLimited, unauthorized } from '../lib/errors'
import type { Logger } from '../log'
import { audit } from '../services/audit'
import { accessForProject, hasSupportGrantFrom, resolveProjectAccess, type ProjectAccess, type ProjectRow, type Viewer } from '../services/access'
import { systemRole } from '../services/users'
import { LIMIT_RULES, type LimitRule } from './rate-limit'

export type AppEnv = {
  Bindings: HttpBindings
  Variables: {
    deps: Deps
    requestId: string
    log: Logger
    ip: string | null
    ipHash: string
    session: AuthSession | null
  }
}

export type Ctx = Context<AppEnv>

// ------------------------------------------------------------------ validation

export function zodDetails(error: z.ZodError): { path: string; message: string }[] {
  return error.issues.slice(0, 20).map((i) => ({ path: i.path.map(String).join('.'), message: i.message }))
}

export async function jsonBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  const type = c.req.header('content-type') ?? ''
  if (!type.toLowerCase().startsWith('application/json')) throw new HttpError(415, 'bad_request', 'Expected application/json')
  let raw: unknown
  try {
    raw = await c.req.json()
  } catch {
    throw badRequest('Malformed JSON')
  }
  const r = schema.safeParse(raw)
  if (!r.success) throw badRequest('Validation failed', zodDetails(r.error))
  return r.data
}

/** Optional JSON body (empty body → {}). */
export async function optionalJsonBody<S extends z.ZodType>(c: Ctx, schema: S): Promise<z.output<S>> {
  const len = c.req.header('content-length')
  if ((len === undefined || len === '0') && !c.req.header('content-type')) {
    const r = schema.safeParse({})
    if (!r.success) throw badRequest('Validation failed', zodDetails(r.error))
    return r.data
  }
  return jsonBody(c, schema)
}

export function queryParams<S extends z.ZodType>(c: Ctx, schema: S, transform?: (q: Record<string, string>) => Record<string, unknown>): z.output<S> {
  const q = c.req.query()
  const r = schema.safeParse(transform ? transform(q) : q)
  if (!r.success) throw badRequest('Invalid query', zodDetails(r.error))
  return r.data
}

export function param(c: Ctx, name: string, pattern = /^[\w-]{1,64}$/): string {
  const v = c.req.param(name)
  if (!v || !pattern.test(v)) throw notFound()
  return v
}

// ------------------------------------------------------------------ session & guards

export const sessionOf = (c: Ctx) => c.get('session')

export function requireAuth(c: Ctx): AuthSession {
  const s = c.get('session')
  if (!s) throw unauthorized()
  return s
}

export const roleOf = (s: AuthSession | null): SystemRole | null => (s ? systemRole(s.user.role) : null)

export function requireStaff(c: Ctx): AuthSession {
  const s = requireAuth(c)
  const r = roleOf(s)
  if (r !== 'support' && r !== 'admin') throw forbidden('Staff only')
  return s
}

export function requireAdmin(c: Ctx): AuthSession {
  const s = requireAuth(c)
  if (roleOf(s) !== 'admin') throw forbidden('Admins only')
  return s
}

/** Admin id when this session is a better-auth impersonation session, else null. */
export const impersonatorOf = (s: AuthSession | null | undefined): string | null => (s?.session as { impersonatedBy?: string | null } | undefined)?.impersonatedBy ?? null
export const isImpersonating = (s: AuthSession) => !!impersonatorOf(s)

/**
 * Sensitive self-service actions (export, deletion, sharing changes, …) are blocked for
 * impersonation sessions — `details.reason = 'impersonation'` lets the web app explain why.
 */
export function requireRealUser(c: Ctx, message = 'Not allowed while impersonating a user'): AuthSession {
  const s = requireAuth(c)
  if (isImpersonating(s)) throw impersonationBlocked(message)
  return s
}

export const impersonationBlocked = (message: string) => new HttpError(403, 'forbidden', message, { reason: 'impersonation' })

/** Refuse if `rule` is exhausted for `key` without counting this request (count with `limit`). */
export function assertNotLimited(c: Ctx, rule: LimitRule, key: string): void {
  const [max] = LIMIT_RULES[rule]
  const r = c.get('deps').limiter.isLimited(`${rule}:${key}`, max)
  if (!r.ok) throw rateLimited(r.retryAfterSec)
}

export function limit(c: Ctx, rule: LimitRule, key: string): void {
  const [max, windowSec] = LIMIT_RULES[rule]
  const r = c.get('deps').limiter.hit(`${rule}:${key}`, max, windowSec)
  if (!r.ok) throw rateLimited(r.retryAfterSec)
}

// ------------------------------------------------------------------ project access

export function viewerOf(c: Ctx): Viewer {
  const s = c.get('session')
  const method = c.req.method
  // Guest credentials (raw viewer-link token or signed grant) authorise reads only; writes require
  // an accepted link (membership).
  const token = method === 'GET' || method === 'HEAD' ? (c.req.header('x-share-token') ?? c.req.query('token') ?? null) : null
  return { userId: s?.user.id ?? null, systemRole: roleOf(s), shareToken: token }
}

async function auditSupportAccess(c: Ctx, a: ProjectAccess): Promise<void> {
  if (a.via !== 'support') return
  const d = c.get('deps')
  const s = c.get('session')
  const key = `${s?.user.id}:${a.project.id}:${c.req.method}`
  if (!d.auditThrottle.shouldLog(key)) return
  await audit(d.db, { actorId: s?.user.id, actorEmail: s?.user.email, action: 'support.project.access', targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta: { method: c.req.method, path: c.req.routePath } }, d.log)
}

export interface ProjectAccessOptions {
  /** Include trashed projects (only the owner ever gets a role on them). */
  includeDeleted?: boolean
  /**
   * The route reads or changes only project *metadata* (name, folder, star, trash state, member and
   * link lists). Everything else — documents, blobs, versions, thumbnails, comments — is content,
   * which impersonating admins may read only through the user's support grant (see below).
   */
  metadata?: boolean
}

/**
 * Resolve the caller's access to a project and require `action`. Callers without any access get
 * 404 (existence of private projects is never revealed); callers with a lesser role get 403.
 */
export async function projectAccess(c: Ctx, projectId: string, action: ProjectAction, opts: ProjectAccessOptions = {}): Promise<ProjectAccess> {
  const d = c.get('deps')
  const a = await resolveProjectAccess(d.db, projectId, viewerOf(c), { includeDeleted: opts.includeDeleted, publicSharing: d.config.features.publicSharing, grants: d.grants })
  return checkAccess(c, a, action, opts)
}

export async function projectAccessFor(c: Ctx, project: ProjectRow, action: ProjectAction, opts: ProjectAccessOptions = {}): Promise<ProjectAccess> {
  const d = c.get('deps')
  const a = await accessForProject(d.db, project, viewerOf(c), { publicSharing: d.config.features.publicSharing, grants: d.grants })
  return checkAccess(c, a, action, opts)
}

/**
 * Content access while an admin impersonates the user: allowed only while the user has an active
 * support grant for the project, and then read-only. Every allowed access is audited; refusals too
 * (de-duplicated per admin, project and route by the audit throttle).
 */
async function impersonationContentAccess(c: Ctx, s: AuthSession, a: ProjectAccess, action: ProjectAction): Promise<ProjectAccess> {
  const d = c.get('deps')
  const admin = impersonatorOf(s)
  const granted = await hasSupportGrantFrom(d.db, a.project.id, s.user.id)
  const meta = { impersonatedUserId: s.user.id, method: c.req.method, path: c.req.routePath, action }
  if (!granted || action !== 'view') {
    if (d.auditThrottle.shouldLog(`impersonation-denied:${admin}:${a.project.id}:${c.req.method}:${c.req.routePath}`)) {
      const reason = granted ? 'read_only' : 'no_support_grant'
      await audit(d.db, { actorId: admin, action: 'admin.impersonate.content_denied', targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta: { ...meta, reason } }, d.log)
    }
    throw impersonationBlocked(
      granted
        ? 'Support access through impersonation is read-only'
        : 'Project content is not available while impersonating a user: the user has not granted support access to this project',
    )
  }
  await audit(d.db, { actorId: admin, action: 'admin.impersonate.content', targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta }, d.log)
  return { ...a, role: 'viewer', via: 'impersonation' }
}

async function checkAccess(c: Ctx, a: ProjectAccess | null, action: ProjectAction, opts: ProjectAccessOptions): Promise<ProjectAccess> {
  if (!a) {
    if (!c.get('session') && action !== 'view') throw unauthorized()
    throw notFound('Project not found')
  }
  const s = c.get('session')
  if (s && !opts.metadata && isImpersonating(s)) return impersonationContentAccess(c, s, a, action)
  if (!can(a.role, action)) throw forbidden(`Requires permission to ${action}`)
  if (a.via === 'support' && action !== 'view') throw forbidden('Support access is read-only')
  await auditSupportAccess(c, a)
  return a
}
