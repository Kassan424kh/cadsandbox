// HTTP API contract between apps/web and apps/server.
// All routes live under /api. JSON in/out unless noted. Auth = better-auth session cookie
// (HttpOnly, Secure, SameSite=Lax). Errors: { error: { code: ApiErrorCode, message: string } }.
// Timestamps are ISO-8601 strings. IDs are opaque strings.
import { z } from 'zod'
import type { GrantRole, OrgRole, ProjectRole, ProjectVisibility, SystemRole } from './roles'

export type ApiErrorCode =
  | 'bad_request'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'payload_too_large'
  | 'rate_limited'
  | 'quota_exceeded'
  | 'internal'

export interface ApiError {
  error: { code: ApiErrorCode; message: string; details?: unknown }
}

export interface Page<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

// ---------------------------------------------------------------- DTOs

export interface UserDTO {
  id: string
  email: string
  name: string
  image: string | null
  role: SystemRole
  emailVerified: boolean
  twoFactorEnabled: boolean
  locale: string
  createdAt: string
}

export interface OrgDTO {
  id: string
  name: string
  slug: string
  logo: string | null
  role: OrgRole // caller's role
  memberCount: number
  createdAt: string
}

export interface MeDTO {
  user: UserDTO
  orgs: OrgDTO[]
  storage: { usedBytes: number; quotaBytes: number }
  /** Pending account deletion (GDPR Art. 17), if the user requested it. */
  deletionScheduledAt: string | null
  /** Version of the terms of service the user last accepted (null: none recorded). */
  termsAcceptedVersion: string | null
}

export interface FolderDTO {
  id: string
  name: string
  parentId: string | null
  /** Folders live in a user's personal space or in an org space. */
  orgId: string | null
  createdAt: string
  updatedAt: string
}

export interface ProjectDTO {
  id: string
  name: string
  description: string
  ownerId: string
  ownerName: string
  orgId: string | null
  folderId: string | null
  visibility: ProjectVisibility
  /** Caller's effective role. */
  role: ProjectRole
  /**
   * Why editing is paused for everyone (single-project reads only): the owner is out of storage, or a
   * design outgrew the per-document limit. Absent/null = editable per role.
   */
  writeBlock?: WriteBlock | null
  thumbnailUrl: string | null
  starred: boolean
  sizeBytes: number
  createdAt: string
  updatedAt: string
  deletedAt: string | null
}

export type WriteBlock = 'storage_full' | 'design_too_large'

export interface ProjectMemberDTO {
  userId: string
  email: string
  name: string
  image: string | null
  role: ProjectRole
  /** Access comes only from an accepted share link — it ends when the link is deleted or expires. */
  viaLink: boolean
  addedAt: string
}

export interface ShareLinkDTO {
  id: string
  token: string
  role: GrantRole
  hasPassword: boolean
  expiresAt: string | null
  createdAt: string
  uses: number
}

export interface OrgGrantDTO {
  orgId: string
  orgName: string
  role: GrantRole
  addedAt: string
}

export interface VersionDTO {
  id: string
  projectId: string
  /** Collab doc name the snapshot belongs to (see docNames below). */
  docName: string
  name: string
  auto: boolean
  sizeBytes: number
  createdBy: string | null
  createdByName: string | null
  createdAt: string
}

export interface CollectionDTO {
  id: string
  name: string
  orgId: string | null
  itemCount: number
  createdAt: string
  updatedAt: string
}

export type CollectionItemKind = 'object' | 'material' | 'component'

export interface CollectionItemDTO {
  id: string
  collectionId: string
  name: string
  kind: CollectionItemKind
  tags: string[]
  /** data: URL (webp, ≤ 64 KB) */
  thumbnail: string | null
  /** JSON payload — a @cadsandbox/doc DocSnapshot (object/component) or MaterialDef (material). */
  payload: unknown
  /** Content hashes of blobs the payload references; stored in the owner's asset space. */
  assets: string[]
  createdAt: string
}

export type TicketStatus = 'open' | 'pending' | 'closed'

export interface TicketMessageDTO {
  id: string
  authorId: string
  authorName: string
  staff: boolean
  body: string
  createdAt: string
}

export interface TicketDTO {
  id: string
  userId: string
  userEmail: string
  subject: string
  status: TicketStatus
  projectId: string | null
  /** When set and in the future, support staff may open projectId read-only. */
  supportAccessUntil: string | null
  messages: TicketMessageDTO[]
  createdAt: string
  updatedAt: string
}

export interface AuditEntryDTO {
  id: string
  actorId: string | null
  actorEmail: string | null
  action: string // e.g. 'admin.user.ban', 'project.share.add', 'auth.login'
  targetType: string | null
  targetId: string | null
  meta: Record<string, unknown>
  createdAt: string
}

export interface AdminUserDTO extends UserDTO {
  banned: boolean
  banReason: string | null
  banExpires: string | null
  projectCount: number
  storageBytes: number
  lastActiveAt: string | null
}

export interface AdminStatsDTO {
  users: number
  newUsers7d: number
  activeUsers7d: number
  projects: number
  orgs: number
  storageBytes: number
  openTickets: number
  collabConnections: number
  collabDocuments: number
}

export interface AnnouncementDTO {
  id: string
  message: string
  level: 'info' | 'warning' | 'critical'
  startsAt: string
  endsAt: string | null
}

/**
 * Operator ("Diensteanbieter") details shown in the imprint, privacy policy and terms — edited by an
 * admin in the admin panel and stored in the database (never in the repository). '' = not set.
 */
export interface LegalOperatorDTO {
  /** Person or company incl. legal form, e.g. "Jane Doe" or "Example GmbH". */
  name: string
  street: string
  /** Postcode and city, e.g. "21244 Buchholz in der Nordheide". */
  postalCity: string
  country: string
  email: string
  phone: string
  vatId: string
  registerCourt: string
  registerNumber: string
  /** Managing director(s) — companies only. */
  representedBy: string
  /** Responsible for content (§ 18 Abs. 2 MStV); defaults to name and address. */
  contentResponsible: string
  /** Contact for privacy requests; defaults to `email`. */
  privacyEmail: string
}

export interface LegalOperatorResponse {
  operator: LegalOperatorDTO | null
  updatedAt: string | null
}

/** Sign-up proof-of-work: find `number` with sha256(salt + number) = challenge (0 ≤ number ≤ maxnumber). */
export interface SignupChallengeDTO {
  algorithm: 'SHA-256'
  challenge: string
  salt: string
  maxnumber: number
  signature: string
}

export interface PublicConfigDTO {
  appName: string
  version: string
  /** Features the server has enabled. The web app also runs fully offline without a server. */
  features: { signup: boolean; signupCaptcha: boolean; collab: boolean; emailVerification: boolean; passkeys: boolean; publicSharing: boolean; errorReporting: boolean }
  limits: { maxBlobBytes: number; maxProjectsFree: number; storageQuotaBytes: number }
  legal: { imprintUrl: string; privacyUrl: string; termsUrl: string; dpaUrl: string }
  /** Path of the Hocuspocus websocket relative to the API origin. */
  collabPath: string
}

// ---------------------------------------------------------------- Collab doc names
// Hocuspocus document names. The server derives projectId from the name for ACL checks.
export const docNames = {
  manifest: (projectId: string) => `project:${projectId}`,
  file: (projectId: string, fileId: string) => `file:${projectId}:${fileId}`,
  parse(name: string): { projectId: string; fileId: string | null } | null {
    const m = /^project:([\w-]{1,64})$/.exec(name)
    if (m) return { projectId: m[1]!, fileId: null }
    const f = /^file:([\w-]{1,64}):([\w-]{1,64})$/.exec(name)
    if (f) return { projectId: f[1]!, fileId: f[2]! }
    return null
  },
}

// ---------------------------------------------------------------- Request schemas

const name = z.string().trim().min(1).max(120)
const id = z.string().min(1).max(64)
const grantRole = z.enum(['editor', 'commenter', 'viewer'])

export const schemas = {
  updateMe: z.object({
    name: name.optional(),
    image: z.string().max(200_000).nullable().optional(),
    locale: z.string().max(16).optional(),
  }),
  deleteMe: z.object({ confirmEmail: z.string().email() }),
  acceptTerms: z.object({ version: z.string().min(1).max(40) }),
  legalOperator: z.object({
    name: z.string().trim().max(200),
    street: z.string().trim().max(200),
    postalCity: z.string().trim().max(200),
    country: z.string().trim().max(100),
    email: z.union([z.literal(''), z.string().trim().email().max(200)]),
    phone: z.string().trim().max(60),
    vatId: z.string().trim().max(40),
    registerCourt: z.string().trim().max(200),
    registerNumber: z.string().trim().max(100),
    representedBy: z.string().trim().max(300),
    contentResponsible: z.string().trim().max(500),
    privacyEmail: z.union([z.literal(''), z.string().trim().email().max(200)]),
  }),
  clientError: z.object({
    message: z.string().max(1000),
    type: z.string().max(100).optional(),
    stack: z.string().max(8000).optional(),
    path: z.string().max(300),
    release: z.string().max(50).optional(),
  }),
  createFolder: z.object({ name, parentId: id.nullable().optional(), orgId: id.nullable().optional() }),
  updateFolder: z.object({ name: name.optional(), parentId: id.nullable().optional() }),
  listProjects: z.object({
    scope: z.enum(['mine', 'shared', 'org', 'trash', 'recent', 'starred', 'all']).default('all'),
    folderId: id.nullable().optional(),
    orgId: id.optional(),
    q: z.string().max(120).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(60),
  }),
  createProject: z.object({
    name,
    description: z.string().max(2000).optional(),
    folderId: id.nullable().optional(),
    orgId: id.nullable().optional(),
    /** Client-generated id, so local-first projects keep their id when uploaded. */
    id: z.string().regex(/^[\w-]{8,64}$/).optional(),
  }),
  updateProject: z.object({
    name: name.optional(),
    description: z.string().max(2000).optional(),
    folderId: id.nullable().optional(),
    visibility: z.enum(['private', 'link', 'public']).optional(),
    starred: z.boolean().optional(),
  }),
  duplicateProject: z.object({ name: name.optional(), folderId: id.nullable().optional() }),
  addMember: z.object({ email: z.string().email(), role: grantRole }),
  updateMember: z.object({ role: grantRole }),
  createLink: z.object({
    role: grantRole,
    expiresAt: z.string().datetime().nullable().optional(),
    password: z.string().min(4).max(128).optional(),
  }),
  acceptLink: z.object({ password: z.string().max(128).optional() }),
  setOrgGrant: z.object({ role: grantRole }),
  createVersion: z.object({ docName: z.string().max(200), name: name }),
  addComment: z.object({
    docName: z.string().max(200),
    text: z.string().trim().min(1).max(5000),
    anchor: z.object({
      nodeId: z.string().max(64).optional(),
      point: z.tuple([z.number(), z.number(), z.number()]).optional(),
      viewId: z.string().max(64).optional(),
    }),
  }),
  replyComment: z.object({ docName: z.string().max(200), text: z.string().trim().min(1).max(5000) }),
  resolveComment: z.object({ docName: z.string().max(200), resolved: z.boolean() }),
  createCollection: z.object({ name, orgId: id.nullable().optional() }),
  updateCollection: z.object({ name }),
  createCollectionItem: z.object({
    name,
    kind: z.enum(['object', 'material', 'component']),
    tags: z.array(z.string().max(40)).max(20).default([]),
    thumbnail: z.string().max(90_000).nullable().optional(),
    payload: z.unknown(),
    assets: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(500).default([]),
  }),
  createTicket: z.object({
    subject: z.string().trim().min(3).max(200),
    message: z.string().trim().min(1).max(10_000),
    projectId: id.nullable().optional(),
    /** User consents to support staff viewing projectId read-only for N days (0 = no access). */
    grantAccessDays: z.number().int().min(0).max(30).default(0),
  }),
  ticketMessage: z.object({ body: z.string().trim().min(1).max(10_000) }),
  adminUpdateTicket: z.object({ status: z.enum(['open', 'pending', 'closed']) }),
  adminBan: z.object({ reason: z.string().max(500).optional(), expiresInDays: z.number().int().min(1).max(3650).optional() }),
  adminSetRole: z.object({ role: z.enum(['user', 'support', 'admin']) }),
  adminAnnouncement: z.object({
    message: z.string().trim().min(1).max(500),
    level: z.enum(['info', 'warning', 'critical']),
    startsAt: z.string().datetime().optional(),
    endsAt: z.string().datetime().nullable().optional(),
  }),
  pageQuery: z.object({
    q: z.string().max(200).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(200).default(50),
  }),
}

export type Schemas = { [K in keyof typeof schemas]: z.infer<(typeof schemas)[K]> }

// ---------------------------------------------------------------- Route table
// Documentation + single source of truth for paths. `:param` segments are URL params.
export const routes = {
  health: 'GET /api/health',
  config: 'GET /api/config',
  announcements: 'GET /api/announcements',
  auth: 'ALL /api/auth/*', // better-auth (email+password, 2FA, sessions, organization, admin plugins)

  me: 'GET /api/me', // MeDTO
  updateMe: 'PATCH /api/me', // schemas.updateMe → UserDTO
  exportMe: 'GET /api/me/export', // application/zip — GDPR Art. 15/20 export (profile, projects, docs, assets, audit)
  deleteMe: 'DELETE /api/me', // schemas.deleteMe → { deletionScheduledAt } (7-day grace, then hard delete)
  cancelDeleteMe: 'POST /api/me/cancel-deletion',
  acceptTerms: 'POST /api/me/terms', // schemas.acceptTerms → MeDTO (records the accepted terms version)
  signupChallenge: 'GET /api/signup-challenge', // proof-of-work challenge; the solution goes in the sign-up's x-captcha header
  clientError: 'POST /api/client-errors', // schemas.clientError → 204; forwarded to the error tracker when configured
  legalOperator: 'GET /api/legal/operator', // LegalOperatorResponse — imprint details for the legal pages (public)
  adminUpdateLegalOperator: 'PUT /api/admin/legal/operator', // schemas.legalOperator → LegalOperatorResponse (admin)

  listFolders: 'GET /api/folders', // ?orgId= → FolderDTO[]
  createFolder: 'POST /api/folders',
  updateFolder: 'PATCH /api/folders/:id',
  deleteFolder: 'DELETE /api/folders/:id', // projects inside move to parent

  listProjects: 'GET /api/projects', // schemas.listProjects → Page<ProjectDTO>
  createProject: 'POST /api/projects', // → ProjectDTO
  getProject: 'GET /api/projects/:id',
  updateProject: 'PATCH /api/projects/:id',
  trashProject: 'DELETE /api/projects/:id', // soft delete (trash, purged after 30 days)
  restoreProject: 'POST /api/projects/:id/restore',
  deleteProject: 'DELETE /api/projects/:id/permanent',
  duplicateProject: 'POST /api/projects/:id/duplicate', // copies all collab docs + blob refs → ProjectDTO
  putThumbnail: 'PUT /api/projects/:id/thumbnail', // image/webp|png body ≤ 512 KB
  getThumbnail: 'GET /api/projects/:id/thumbnail',

  listMembers: 'GET /api/projects/:id/members',
  addMember: 'POST /api/projects/:id/members',
  updateMember: 'PATCH /api/projects/:id/members/:userId',
  removeMember: 'DELETE /api/projects/:id/members/:userId',
  listLinks: 'GET /api/projects/:id/links',
  createLink: 'POST /api/projects/:id/links',
  deleteLink: 'DELETE /api/projects/:id/links/:linkId',
  acceptLink: 'POST /api/share/:token/accept', // → { projectId, role }
  listOrgGrants: 'GET /api/projects/:id/orgs',
  setOrgGrant: 'PUT /api/projects/:id/orgs/:orgId',
  removeOrgGrant: 'DELETE /api/projects/:id/orgs/:orgId',
  orgProjects: 'GET /api/orgs/:orgId/projects', // → ProjectDTO[] shared with / owned in org

  // Comments via REST: lets `commenter` role users (read-only on the Yjs doc) comment; the server
  // applies the change to the collab doc's `comments` map so everyone sees it live.
  addComment: 'POST /api/projects/:id/comments', // schemas.addComment → { id }
  replyComment: 'POST /api/projects/:id/comments/:commentId/replies', // schemas.replyComment
  resolveComment: 'PATCH /api/projects/:id/comments/:commentId', // schemas.resolveComment

  getBlob: 'GET /api/projects/:id/blobs/:hash', // hash = sha256 hex; immutable, cacheable
  headBlob: 'HEAD /api/projects/:id/blobs/:hash',
  putBlob: 'PUT /api/projects/:id/blobs/:hash', // raw body; server verifies sha256 == hash

  listVersions: 'GET /api/projects/:id/versions', // ?docName=
  createVersion: 'POST /api/projects/:id/versions',
  getVersion: 'GET /api/projects/:id/versions/:versionId', // application/octet-stream Yjs update
  restoreVersion: 'POST /api/projects/:id/versions/:versionId/restore',

  listCollections: 'GET /api/collections',
  createCollection: 'POST /api/collections',
  updateCollection: 'PATCH /api/collections/:id',
  deleteCollection: 'DELETE /api/collections/:id',
  listCollectionItems: 'GET /api/collections/:id/items',
  createCollectionItem: 'POST /api/collections/:id/items',
  deleteCollectionItem: 'DELETE /api/collections/:id/items/:itemId',
  getAsset: 'GET /api/assets/:hash', // user-scoped asset space (collection item blobs)
  putAsset: 'PUT /api/assets/:hash',

  createTicket: 'POST /api/support/tickets',
  listTickets: 'GET /api/support/tickets',
  getTicket: 'GET /api/support/tickets/:id',
  ticketMessage: 'POST /api/support/tickets/:id/messages',
  revokeSupportAccess: 'POST /api/support/tickets/:id/revoke-access',

  adminStats: 'GET /api/admin/stats',
  adminUsers: 'GET /api/admin/users', // schemas.pageQuery → Page<AdminUserDTO>
  adminUser: 'GET /api/admin/users/:id', // → { user: AdminUserDTO, orgs: OrgDTO[], projects: ProjectDTO[], sessions: {...}[] }
  adminBan: 'POST /api/admin/users/:id/ban',
  adminUnban: 'POST /api/admin/users/:id/unban',
  adminSetRole: 'POST /api/admin/users/:id/role',
  adminRevokeSessions: 'POST /api/admin/users/:id/revoke-sessions',
  adminReset2fa: 'POST /api/admin/users/:id/reset-2fa',
  adminVerifyEmail: 'POST /api/admin/users/:id/verify-email',
  adminDeleteUser: 'DELETE /api/admin/users/:id',
  adminOrgs: 'GET /api/admin/orgs',
  adminProjects: 'GET /api/admin/projects', // metadata only — content needs a user support grant
  adminTickets: 'GET /api/admin/tickets', // ?status=
  adminTicketMessage: 'POST /api/admin/tickets/:id/messages',
  adminUpdateTicket: 'PATCH /api/admin/tickets/:id',
  adminAudit: 'GET /api/admin/audit', // ?actorId=&action=&page=
  adminAnnouncements: 'GET /api/admin/announcements',
  adminCreateAnnouncement: 'POST /api/admin/announcements',
  adminDeleteAnnouncement: 'DELETE /api/admin/announcements/:id',

  collab: 'WS /collab', // Hocuspocus; auth via session cookie (or `token` = share-link token for anonymous public viewers)
} as const

export type RouteKey = keyof typeof routes

/** Fill `:params` of a route path. */
export function routePath(key: RouteKey, params: Record<string, string> = {}): string {
  const path = routes[key].split(' ')[1]!
  return path.replace(/:(\w+)/g, (_, k: string) => encodeURIComponent(params[k] ?? ''))
}

/**
 * Terms of service: bump `termsVersion` (the terms' "last updated" date) whenever the terms change —
 * signed-in users are then asked to accept the new version. `minAge` is stated at sign-up.
 */
export const LEGAL = {
  termsVersion: '2026-09-26',
  minAge: 16,
} as const

export const LIMITS = {
  maxBlobBytes: 200 * 1024 * 1024,
  maxThumbnailBytes: 512 * 1024,
  defaultStorageQuotaBytes: 1024 * 1024 * 1024,
  trashRetentionDays: 30,
  accountDeletionGraceDays: 7,
  auditRetentionDays: 365,
} as const
