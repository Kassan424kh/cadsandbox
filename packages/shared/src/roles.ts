// Access model — shared by server (enforcement) and web (UI affordances).
//
// A project is owned by exactly one user. Access is the MAX of:
//   • owner                       → 'owner'
//   • direct member grant          → member.role
//   • org grant (project shared with an org the user belongs to) → grant.role
//   • accepted share link          → link.role (stored as a member row on accept)
//   • public visibility            → 'viewer' (read-only, even for anonymous users)
//   • time-boxed support grant     → 'viewer' for staff while the user-granted window is open

export type ProjectRole = 'owner' | 'editor' | 'commenter' | 'viewer'
export type GrantRole = Exclude<ProjectRole, 'owner'>
export type OrgRole = 'owner' | 'admin' | 'member'
export type SystemRole = 'user' | 'support' | 'admin'
export type ProjectVisibility = 'private' | 'link' | 'public'

export const PROJECT_ROLE_RANK: Record<ProjectRole, number> = { viewer: 1, commenter: 2, editor: 3, owner: 4 }

export type ProjectAction =
  | 'view' // open, read documents & assets, export
  | 'comment' // add/resolve comments
  | 'edit' // modify documents, upload assets, create versions
  | 'share' // manage members, links, org grants
  | 'manage' // rename, move, visibility, trash/restore
  | 'delete' // permanent delete, transfer

const MIN_ROLE: Record<ProjectAction, ProjectRole> = {
  view: 'viewer',
  comment: 'commenter',
  edit: 'editor',
  share: 'editor',
  manage: 'owner',
  delete: 'owner',
}

export function can(role: ProjectRole | null | undefined, action: ProjectAction): boolean {
  if (!role) return false
  return PROJECT_ROLE_RANK[role] >= PROJECT_ROLE_RANK[MIN_ROLE[action]]
}

export function maxRole(a: ProjectRole | null | undefined, b: ProjectRole | null | undefined): ProjectRole | null {
  if (!a) return b ?? null
  if (!b) return a
  return PROJECT_ROLE_RANK[a] >= PROJECT_ROLE_RANK[b] ? a : b
}

export type OrgAction = 'view' | 'manageMembers' | 'manageProjects' | 'manageOrg' | 'deleteOrg'

const ORG_RANK: Record<OrgRole, number> = { member: 1, admin: 2, owner: 3 }
const ORG_MIN: Record<OrgAction, OrgRole> = {
  view: 'member',
  manageMembers: 'admin',
  manageProjects: 'admin',
  manageOrg: 'admin',
  deleteOrg: 'owner',
}

export function canOrg(role: OrgRole | null | undefined, action: OrgAction): boolean {
  if (!role) return false
  return ORG_RANK[role] >= ORG_RANK[ORG_MIN[action]]
}

export const ROLE_LABEL: Record<ProjectRole, string> = {
  owner: 'Owner',
  editor: 'Can edit',
  commenter: 'Can comment',
  viewer: 'Can view',
}
