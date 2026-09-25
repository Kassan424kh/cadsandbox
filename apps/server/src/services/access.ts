// Effective project role — exactly the model in @cadsandbox/shared roles.ts:
//   max(owner, direct member, org grant via membership, accepted share link, public → viewer,
//       valid support grant → viewer for staff).
// Share-link semantics: links (and memberships gained through them) are only effective while the
// project's visibility is 'link' or 'public' and the link is unexpired. Presenting a credential
// without accepting (anonymous guests) works only for links with role 'viewer' and yields 'viewer':
// the raw token for links without password, or a signed grant (from accept) for password links.
// Editor/commenter links must be accepted by a signed-in user (→ membership).
import { and, eq, gt, isNull, sql, type SQL } from 'drizzle-orm'
import { PROJECT_ROLE_RANK, type ProjectRole, type SystemRole } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { member, orgProjectGrants, projectMembers, projects, shareLinks, supportGrants } from '../db/schema'
import { hashToken } from '../lib/crypto'
import { isShareGrant, type ShareGrants } from './share-grants'

export type ProjectRow = typeof projects.$inferSelect
/** 'impersonation': an admin acting as the user, reading content through that user's support grant. */
export type AccessVia = 'owner' | 'member' | 'org' | 'link' | 'public' | 'support' | 'impersonation'

export interface Viewer {
  userId: string | null
  systemRole: SystemRole | null
  /** Guest credential presented by the caller (header / query / collab token): raw link token or signed grant. */
  shareToken?: string | null
}

export interface ProjectAccess {
  project: ProjectRow
  role: ProjectRole
  via: AccessVia
  /** Share link that granted access to an anonymous/unaccepted caller. */
  linkId: string | null
}

export interface AccessOptions {
  /** Include trashed projects (only the owner ever gets a role on them). */
  includeDeleted?: boolean
  publicSharing: boolean
  /** Verifier for signed share grants; without it only raw link tokens are accepted. */
  grants?: ShareGrants
}

export const isStaff = (r: SystemRole | null | undefined) => r === 'support' || r === 'admin'

const linksActive = (p: ProjectRow) => p.visibility !== 'private'

export function effectiveVisibility(v: ProjectRow['visibility'], publicSharing: boolean): ProjectRow['visibility'] {
  return v === 'public' && !publicSharing ? 'link' : v
}

export async function resolveProjectAccess(db: DbOrTx, projectId: string, viewer: Viewer, opts: AccessOptions): Promise<ProjectAccess | null> {
  if (!/^[\w-]{1,64}$/.test(projectId)) return null
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1)
  if (!project) return null
  return accessForProject(db, project, viewer, opts)
}

export async function accessForProject(db: DbOrTx, project: ProjectRow, viewer: Viewer, opts: AccessOptions): Promise<ProjectAccess | null> {
  const uid = viewer.userId
  if (project.deletedAt) {
    if (opts.includeDeleted && uid && uid === project.ownerId) return { project, role: 'owner', via: 'owner', linkId: null }
    return null
  }
  if (uid && uid === project.ownerId) return { project, role: 'owner', via: 'owner', linkId: null }

  const now = new Date()
  const visibility = effectiveVisibility(project.visibility, opts.publicSharing)
  const acc: { role: ProjectRole | null; via: AccessVia; linkId: string | null } = { role: null, via: 'member', linkId: null }
  const consider = (role: ProjectRole | null | undefined, via: AccessVia, linkId: string | null = null) => {
    if (role && (!acc.role || PROJECT_ROLE_RANK[role] > PROJECT_ROLE_RANK[acc.role])) Object.assign(acc, { role, via, linkId })
  }

  if (uid) {
    const [members, grants] = await Promise.all([
      db
        .select({ role: projectMembers.role, linkId: projectMembers.linkId, expiresAt: shareLinks.expiresAt })
        .from(projectMembers)
        .leftJoin(shareLinks, eq(shareLinks.id, projectMembers.linkId))
        .where(and(eq(projectMembers.projectId, project.id), eq(projectMembers.userId, uid))),
      db
        .select({ role: orgProjectGrants.role })
        .from(orgProjectGrants)
        .innerJoin(member, and(eq(member.organizationId, orgProjectGrants.orgId), eq(member.userId, uid)))
        .where(eq(orgProjectGrants.projectId, project.id)),
    ])
    for (const m of members) {
      if (!m.linkId) consider(m.role, 'member')
      else if (linksActive(project) && (!m.expiresAt || m.expiresAt > now)) consider(m.role, 'link', m.linkId)
    }
    for (const g of grants) consider(g.role, 'org')
  }

  if (viewer.shareToken && linksActive(project) && !acc.role) {
    const link = await linkForCredential(db, viewer.shareToken, opts.grants)
    if (link && link.projectId === project.id && link.role === 'viewer') consider('viewer', 'link', link.id)
  }

  if (!acc.role && visibility === 'public') consider('viewer', 'public')

  if (!acc.role && isStaff(viewer.systemRole)) {
    const [grant] = await db
      .select({ id: supportGrants.id })
      .from(supportGrants)
      .where(and(eq(supportGrants.projectId, project.id), isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, now)))
      .limit(1)
    if (grant) consider('viewer', 'support')
  }

  if (!acc.role) return null
  return { project, role: acc.role, via: acc.via, linkId: acc.linkId }
}

/**
 * Impersonation content rule (privacy by design): an admin acting as a user may read a project's
 * content only while that user has an active support grant for it (given in a support ticket, not
 * revoked, not expired) — and then read-only. Metadata stays visible without a grant.
 */
export async function hasSupportGrantFrom(db: DbOrTx, projectId: string, userId: string): Promise<boolean> {
  const [grant] = await db
    .select({ id: supportGrants.id })
    .from(supportGrants)
    .where(and(eq(supportGrants.projectId, projectId), eq(supportGrants.grantedBy, userId), isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, new Date())))
    .limit(1)
  return !!grant
}

/** Look up an unexpired share link by raw token (constant-time via hashing + unique index). */
export async function findActiveLink(db: DbOrTx, token: string) {
  if (!token || token.length > 128 || !/^[\w-]+$/.test(token)) return null
  const [link] = await db.select().from(shareLinks).where(eq(shareLinks.tokenHash, hashToken(token))).limit(1)
  if (!link) return null
  if (link.expiresAt && link.expiresAt <= new Date()) return null
  return link
}

/**
 * Resolve a guest credential to its active link: a signed grant (password already proven at accept)
 * or the raw token of a link without password. Deleted or expired links never resolve.
 */
export async function linkForCredential(db: DbOrTx, credential: string, grants?: ShareGrants) {
  if (isShareGrant(credential)) {
    const claims = grants?.verify(credential)
    if (!claims) return null
    const [link] = await db.select().from(shareLinks).where(eq(shareLinks.id, claims.linkId)).limit(1)
    if (!link || link.projectId !== claims.projectId) return null
    if (link.expiresAt && link.expiresAt <= new Date()) return null
    return link
  }
  const link = await findActiveLink(db, credential)
  return link && !link.passwordHash ? link : null
}

const RANK_CASE = (col: string) => `CASE ${col} WHEN 'editor' THEN 3 WHEN 'commenter' THEN 2 WHEN 'viewer' THEN 1 ELSE 0 END`

/**
 * SQL expression: caller's role rank (0–4) on the current `projects` row, from ownership, direct and
 * link memberships, and org grants (public/support access are intentionally not listed).
 */
export function roleRankSql(userId: string): SQL<number> {
  return sql<number>`GREATEST(
    CASE WHEN ${projects.ownerId} = ${userId} THEN 4 ELSE 0 END,
    COALESCE((SELECT MAX(${sql.raw(RANK_CASE('pm.role'))}) FROM project_members pm
      LEFT JOIN share_links sl ON sl.id = pm.link_id
      WHERE pm.project_id = ${projects.id} AND pm.user_id = ${userId}
        AND (pm.link_id IS NULL OR (${projects.visibility} <> 'private' AND (sl.expires_at IS NULL OR sl.expires_at > now())))), 0),
    COALESCE((SELECT MAX(${sql.raw(RANK_CASE('g.role'))}) FROM org_project_grants g
      JOIN member m ON m.organization_id = g.org_id AND m.user_id = ${userId}
      WHERE g.project_id = ${projects.id}), 0)
  )`
}

const BY_RANK: ProjectRole[] = ['viewer', 'viewer', 'commenter', 'editor', 'owner']
export const roleFromRank = (rank: number): ProjectRole | null => (rank > 0 ? BY_RANK[Math.min(4, rank)]! : null)
