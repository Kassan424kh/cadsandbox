// Typed client for EVERY route of the shared API contract (`routes` in @cadsandbox/shared).
// Paths and methods come from the route table, so a contract change surfaces here at compile time.
import {
  routePath,
  routes,
  type AdminStatsDTO,
  type AdminUserDTO,
  type AnnouncementDTO,
  type AuditEntryDTO,
  type CollectionDTO,
  type CollectionItemDTO,
  type FolderDTO,
  type GrantRole,
  type MeDTO,
  type OrgDTO,
  type OrgGrantDTO,
  type Page,
  type ProjectDTO,
  type ProjectMemberDTO,
  type ProjectRole,
  type PublicConfigDTO,
  type RouteKey,
  type Schemas,
  type LegalOperatorResponse,
  type ShareLinkDTO,
  type SignupChallengeDTO,
  type TicketDTO,
  type TicketStatus,
  type UserDTO,
  type VersionDTO,
} from '@cadsandbox/shared'
import { apiUrl, request, type Query, type RequestOptions } from './client'

type Params = Record<string, string>
type In<K extends keyof Schemas> = Partial<Schemas[K]> & Pick<Schemas[K], RequiredKeys<Schemas[K]>>
type RequiredKeys<T> = { [K in keyof T]-?: undefined extends T[K] ? never : K }[keyof T]

function call<T>(key: RouteKey, params: Params = {}, opts: RequestOptions = {}): Promise<T> {
  const method = routes[key].split(' ')[0]!
  return request<T>(routePath(key, params), { ...opts, method: method === 'ALL' ? 'GET' : method })
}

/** Accept both `Page<T>` and bare arrays (the server may return either for small lists). */
export function toPage<T>(res: Page<T> | T[] | null | undefined, page = 1, pageSize = 50): Page<T> {
  if (Array.isArray(res)) return { items: res, total: res.length, page, pageSize }
  return res ?? { items: [], total: 0, page, pageSize }
}
function toList<T>(res: Page<T> | T[] | null | undefined): T[] {
  return Array.isArray(res) ? res : (res?.items ?? [])
}

// ------------------------------------------------------------------ app-level DTOs not (yet) in the contract
export interface AdminSessionDTO {
  id: string
  ipAddress: string | null
  userAgent: string | null
  createdAt: string
  expiresAt: string
  impersonatedBy?: string | null
}
export interface AdminUserDetailDTO {
  user: AdminUserDTO
  orgs: OrgDTO[]
  projects: ProjectDTO[]
  sessions: AdminSessionDTO[]
}
export type AddMemberResult = { status: 'added'; member: ProjectMemberDTO | null } | { status: 'invited'; email: string; role: GrantRole }

export interface CommentAnchor {
  nodeId?: string
  point?: [number, number, number]
  viewId?: string
}
export interface AuditQuery {
  actorId?: string
  action?: string
  targetType?: string
  targetId?: string
  page?: number
  pageSize?: number
}
export interface ListProjectsQuery {
  scope?: Schemas['listProjects']['scope']
  folderId?: string | null
  orgId?: string
  q?: string
  page?: number
  pageSize?: number
}

const withShare = (shareToken?: string | null): RequestOptions => (shareToken ? { shareToken } : {})

export const api = {
  health: () => call<{ ok: boolean }>('health', {}, { retries: 0, timeoutMs: 5000 }),
  config: () => call<PublicConfigDTO>('config', {}, { retries: 1, timeoutMs: 8000 }),
  announcements: () => call<AnnouncementDTO[]>('announcements').then(toList),

  legal: {
    /** Operator details for the imprint, privacy policy and terms (public). */
    operator: () => call<LegalOperatorResponse>('legalOperator', {}, { retries: 1 }),
  },
  /** Proof-of-work challenge for the sign-up form (see data/auth/pow.ts). */
  signupChallenge: () => call<SignupChallengeDTO>('signupChallenge', {}),
  me: {
    get: () => call<MeDTO>('me', {}, { retries: 1 }),
    update: (body: Schemas['updateMe']) => call<UserDTO>('updateMe', {}, { json: body }),
    /** Direct download URL (same-origin, cookie-authenticated) — use as <a href download>. */
    exportUrl: () => apiUrl(routePath('exportMe')),
    delete: (confirmEmail: string) => call<{ deletionScheduledAt: string }>('deleteMe', {}, { json: { confirmEmail } }),
    cancelDeletion: () => call<void>('cancelDeleteMe', {}, { responseType: 'void' }),
    acceptTerms: (version: string) => call<MeDTO>('acceptTerms', {}, { json: { version } }),
  },

  folders: {
    list: (orgId?: string | null) => call<FolderDTO[]>('listFolders', {}, { query: { orgId: orgId ?? undefined } }).then(toList),
    create: (body: In<'createFolder'>) => call<FolderDTO>('createFolder', {}, { json: body }),
    update: (id: string, body: Schemas['updateFolder']) => call<FolderDTO>('updateFolder', { id }, { json: body }),
    remove: (id: string) => call<void>('deleteFolder', { id }, { responseType: 'void' }),
  },

  projects: {
    list: (q: ListProjectsQuery = {}) =>
      call<Page<ProjectDTO> | ProjectDTO[]>('listProjects', {}, { query: q as Query }).then((r) => toPage(r, q.page, q.pageSize)),
    create: (body: In<'createProject'>) => call<ProjectDTO>('createProject', {}, { json: body }),
    get: (id: string, shareToken?: string | null) => call<ProjectDTO>('getProject', { id }, withShare(shareToken)),
    update: (id: string, body: Schemas['updateProject']) => call<ProjectDTO>('updateProject', { id }, { json: body }),
    trash: (id: string) => call<void>('trashProject', { id }, { responseType: 'void' }),
    restore: (id: string) => call<ProjectDTO>('restoreProject', { id }),
    remove: (id: string) => call<void>('deleteProject', { id }, { responseType: 'void' }),
    duplicate: (id: string, body: Schemas['duplicateProject'] = {}) => call<ProjectDTO>('duplicateProject', { id }, { json: body }),
    putThumbnail: (id: string, image: Blob) =>
      call<void>('putThumbnail', { id }, { body: image, contentType: image.type || 'image/webp', responseType: 'void', retries: 1 }),
    thumbnailUrl: (id: string) => apiUrl(routePath('getThumbnail', { id })),
  },

  members: {
    list: (id: string) => call<ProjectMemberDTO[]>('listMembers', { id }).then(toList),
    /** 201 → added an existing (verified) account; 202 → pending e-mail invitation. */
    add: (id: string, email: string, role: GrantRole) => call<AddMemberResult>('addMember', { id }, { json: { email, role } }),
    update: (id: string, userId: string, role: GrantRole) => call<ProjectMemberDTO>('updateMember', { id, userId }, { json: { role } }),
    remove: (id: string, userId: string) => call<void>('removeMember', { id, userId }, { responseType: 'void' }),
  },

  links: {
    list: (id: string) => call<ShareLinkDTO[]>('listLinks', { id }).then(toList),
    create: (id: string, body: In<'createLink'>) => call<ShareLinkDTO>('createLink', { id }, { json: body }),
    remove: (id: string, linkId: string) => call<void>('deleteLink', { id, linkId }, { responseType: 'void' }),
    accept: (token: string, password?: string) =>
      call<{ projectId: string; role: ProjectRole; grant?: string; grantExpiresAt?: string }>('acceptLink', { token }, { json: password ? { password } : {} }),
  },

  orgGrants: {
    list: (id: string) => call<OrgGrantDTO[]>('listOrgGrants', { id }).then(toList),
    set: (id: string, orgId: string, role: GrantRole) => call<OrgGrantDTO>('setOrgGrant', { id, orgId }, { json: { role } }),
    remove: (id: string, orgId: string) => call<void>('removeOrgGrant', { id, orgId }, { responseType: 'void' }),
  },
  orgProjects: (orgId: string) => call<ProjectDTO[] | Page<ProjectDTO>>('orgProjects', { orgId }).then(toList),

  comments: {
    add: (id: string, body: { docName: string; text: string; anchor: CommentAnchor }) =>
      call<{ id: string }>('addComment', { id }, { json: body }),
    reply: (id: string, commentId: string, body: { docName: string; text: string }) =>
      call<{ id?: string }>('replyComment', { id, commentId }, { json: body }),
    resolve: (id: string, commentId: string, body: { docName: string; resolved: boolean }) =>
      call<void>('resolveComment', { id, commentId }, { json: body, responseType: 'void' }),
  },

  blobs: {
    url: (id: string, hash: string) => apiUrl(routePath('getBlob', { id, hash })),
    get: (id: string, hash: string, shareToken?: string | null) =>
      call<Response>('getBlob', { id, hash }, { ...withShare(shareToken), responseType: 'response', timeoutMs: 120_000 }),
    exists: (id: string, hash: string) =>
      call<Response>('headBlob', { id, hash }, { responseType: 'response', retries: 1 }).then(
        () => true,
        (e: unknown) => {
          if ((e as { status?: number }).status === 404) return false
          throw e
        },
      ),
    put: (id: string, hash: string, bytes: BodyInit, mime: string) =>
      call<void>('putBlob', { id, hash }, { body: bytes, contentType: mime || 'application/octet-stream', responseType: 'void', timeoutMs: 600_000, retries: 2 }),
  },

  versions: {
    list: (id: string, docName: string) => call<VersionDTO[]>('listVersions', { id }, { query: { docName } }).then(toList),
    create: (id: string, docName: string, name: string) => call<VersionDTO>('createVersion', { id }, { json: { docName, name } }),
    get: (id: string, versionId: string) => call<ArrayBuffer>('getVersion', { id, versionId }, { responseType: 'arrayBuffer' }),
    restore: (id: string, versionId: string) => call<void>('restoreVersion', { id, versionId }, { responseType: 'void' }),
  },

  collections: {
    list: () => call<CollectionDTO[]>('listCollections').then(toList),
    create: (name: string, orgId?: string | null) => call<CollectionDTO>('createCollection', {}, { json: { name, orgId: orgId ?? null } }),
    update: (id: string, name: string) => call<CollectionDTO>('updateCollection', { id }, { json: { name } }),
    remove: (id: string) => call<void>('deleteCollection', { id }, { responseType: 'void' }),
    items: (id: string) => call<CollectionItemDTO[]>('listCollectionItems', { id }).then(toList),
    addItem: (id: string, body: In<'createCollectionItem'>) => call<CollectionItemDTO>('createCollectionItem', { id }, { json: body }),
    removeItem: (id: string, itemId: string) => call<void>('deleteCollectionItem', { id, itemId }, { responseType: 'void' }),
  },

  assets: {
    get: (hash: string) => call<Response>('getAsset', { hash }, { responseType: 'response', timeoutMs: 120_000 }),
    put: (hash: string, bytes: BodyInit, mime: string) =>
      call<void>('putAsset', { hash }, { body: bytes, contentType: mime || 'application/octet-stream', responseType: 'void', timeoutMs: 600_000, retries: 2 }),
  },

  support: {
    create: (body: In<'createTicket'>) => call<TicketDTO>('createTicket', {}, { json: body }),
    list: () => call<TicketDTO[] | Page<TicketDTO>>('listTickets').then(toList),
    get: (id: string) => call<TicketDTO>('getTicket', { id }),
    message: (id: string, body: string) => call<TicketDTO>('ticketMessage', { id }, { json: { body } }),
    revokeAccess: (id: string) => call<TicketDTO>('revokeSupportAccess', { id }),
  },

  admin: {
    stats: () => call<AdminStatsDTO>('adminStats'),
    users: (q: { q?: string; page?: number; pageSize?: number } = {}) =>
      call<Page<AdminUserDTO> | AdminUserDTO[]>('adminUsers', {}, { query: q }).then((r) => toPage(r, q.page, q.pageSize)),
    user: (id: string) => call<AdminUserDetailDTO>('adminUser', { id }),
    ban: (id: string, body: Schemas['adminBan']) => call<void>('adminBan', { id }, { json: body, responseType: 'void' }),
    unban: (id: string) => call<void>('adminUnban', { id }, { responseType: 'void' }),
    setRole: (id: string, role: Schemas['adminSetRole']['role']) => call<void>('adminSetRole', { id }, { json: { role }, responseType: 'void' }),
    revokeSessions: (id: string) => call<void>('adminRevokeSessions', { id }, { responseType: 'void' }),
    reset2fa: (id: string) => call<void>('adminReset2fa', { id }, { responseType: 'void' }),
    verifyEmail: (id: string) => call<void>('adminVerifyEmail', { id }, { responseType: 'void' }),
    deleteUser: (id: string) => call<void>('adminDeleteUser', { id }, { responseType: 'void' }),
    orgs: (q: { q?: string; page?: number; pageSize?: number } = {}) =>
      call<Page<OrgDTO> | OrgDTO[]>('adminOrgs', {}, { query: q }).then((r) => toPage(r, q.page, q.pageSize)),
    projects: (q: { q?: string; page?: number; pageSize?: number } = {}) =>
      call<Page<ProjectDTO> | ProjectDTO[]>('adminProjects', {}, { query: q }).then((r) => toPage(r, q.page, q.pageSize)),
    tickets: (status?: TicketStatus | 'all') =>
      call<TicketDTO[] | Page<TicketDTO>>('adminTickets', {}, { query: { status: status === 'all' ? undefined : status } }).then(toList),
    ticketMessage: (id: string, body: string) => call<TicketDTO>('adminTicketMessage', { id }, { json: { body } }),
    updateTicket: (id: string, status: TicketStatus) => call<TicketDTO>('adminUpdateTicket', { id }, { json: { status } }),
    audit: (q: AuditQuery = {}) =>
      call<Page<AuditEntryDTO> | AuditEntryDTO[]>('adminAudit', {}, { query: q as Query }).then((r) => toPage(r, q.page, q.pageSize)),
    announcements: () => call<AnnouncementDTO[]>('adminAnnouncements').then(toList),
    createAnnouncement: (body: In<'adminAnnouncement'>) => call<AnnouncementDTO>('adminCreateAnnouncement', {}, { json: body }),
    updateLegalOperator: (body: In<'legalOperator'>) => call<LegalOperatorResponse>('adminUpdateLegalOperator', {}, { json: body }),
    deleteAnnouncement: (id: string) => call<void>('adminDeleteAnnouncement', { id }, { responseType: 'void' }),
  },
}

export type Api = typeof api
