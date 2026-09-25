// Organization data via the better-auth organization plugin.
import { useQuery } from '@tanstack/react-query'
import type { OrgRole } from '@cadsandbox/shared'
import { authClient, unwrap } from '../../data/auth/client'

export interface OrgMember {
  id: string
  userId: string
  role: OrgRole
  createdAt?: string | Date
  user: { name: string; email: string; image?: string | null }
}

export interface OrgInvitation {
  id: string
  email: string
  role: OrgRole
  status: string
  expiresAt?: string | Date
  organizationId?: string
  organizationName?: string
}

export interface FullOrg {
  id: string
  name: string
  slug: string
  logo?: string | null
  members: OrgMember[]
  invitations: OrgInvitation[]
}

export const orgKey = (orgId: string) => ['org', orgId] as const

export function useFullOrg(orgId: string, enabled = true) {
  return useQuery({
    queryKey: orgKey(orgId),
    enabled,
    queryFn: async () => (await unwrap(authClient.organization.getFullOrganization({ query: { organizationId: orgId } }))) as unknown as FullOrg,
  })
}

export function useMyInvitations(enabled: boolean) {
  return useQuery({
    queryKey: ['org', 'my-invitations'],
    enabled,
    retry: false,
    queryFn: async () => ((await unwrap(authClient.organization.listUserInvitations())) ?? []) as unknown as OrgInvitation[],
  })
}
