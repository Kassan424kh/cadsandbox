// Organisation helpers (membership lookups, DTOs).
import { and, count, eq, inArray } from 'drizzle-orm'
import type { OrgDTO, OrgRole } from '@cadsandbox/shared'
import type { DbOrTx } from '../db/client'
import { member, organization } from '../db/schema'

export const orgRole = (r: string | null | undefined): OrgRole => {
  const roles = (r ?? '').split(',').map((x) => x.trim())
  if (roles.includes('owner')) return 'owner'
  if (roles.includes('admin')) return 'admin'
  return 'member'
}

export async function membershipRole(db: DbOrTx, orgId: string, userId: string): Promise<OrgRole | null> {
  const [m] = await db
    .select({ role: member.role })
    .from(member)
    .where(and(eq(member.organizationId, orgId), eq(member.userId, userId)))
    .limit(1)
  return m ? orgRole(m.role) : null
}

export function orgDTO(o: typeof organization.$inferSelect, role: OrgRole, memberCount: number): OrgDTO {
  return { id: o.id, name: o.name, slug: o.slug, logo: o.logo ?? null, role, memberCount, createdAt: o.createdAt.toISOString() }
}

async function memberCounts(db: DbOrTx, orgIds: string[]): Promise<Map<string, number>> {
  if (!orgIds.length) return new Map()
  const rows = await db
    .select({ orgId: member.organizationId, n: count() })
    .from(member)
    .where(inArray(member.organizationId, orgIds))
    .groupBy(member.organizationId)
  return new Map(rows.map((r) => [r.orgId, Number(r.n)]))
}

export async function orgsOfUser(db: DbOrTx, userId: string): Promise<OrgDTO[]> {
  const rows = await db
    .select({ o: organization, role: member.role })
    .from(member)
    .innerJoin(organization, eq(organization.id, member.organizationId))
    .where(eq(member.userId, userId))
  const counts = await memberCounts(
    db,
    rows.map((r) => r.o.id),
  )
  return rows.map((r) => orgDTO(r.o, orgRole(r.role), counts.get(r.o.id) ?? 0)).sort((a, b) => a.name.localeCompare(b.name))
}

export async function orgsWithCounts(db: DbOrTx, orgs: (typeof organization.$inferSelect)[], roleFor: (orgId: string) => OrgRole): Promise<OrgDTO[]> {
  const counts = await memberCounts(
    db,
    orgs.map((o) => o.id),
  )
  return orgs.map((o) => orgDTO(o, roleFor(o.id), counts.get(o.id) ?? 0))
}
