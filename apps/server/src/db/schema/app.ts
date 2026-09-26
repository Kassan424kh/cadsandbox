// Application tables. Every FK to user/project cascades so GDPR hard-deletes are complete.
import { sql } from 'drizzle-orm'
import { bigint, boolean, customType, index, integer, jsonb, pgTable, primaryKey, text, timestamp, unique, type AnyPgColumn } from 'drizzle-orm/pg-core'
import { organization, user } from './auth'

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' })

export const bytea = customType<{ data: Uint8Array; driverData: Uint8Array }>({
  dataType: () => 'bytea',
  toDriver: (v) => (Buffer.isBuffer(v) ? v : Buffer.from(v.buffer, v.byteOffset, v.byteLength)),
  fromDriver: (v) => (v instanceof Uint8Array ? v : new Uint8Array(v as ArrayBufferLike)),
})

export const folders = pgTable(
  'folders',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    orgId: text('org_id').references(() => organization.id, { onDelete: 'cascade' }),
    parentId: text('parent_id').references((): AnyPgColumn => folders.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('folders_owner_idx').on(t.ownerId), index('folders_org_idx').on(t.orgId), index('folders_parent_idx').on(t.parentId)],
)

export const projects = pgTable(
  'projects',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    orgId: text('org_id').references(() => organization.id, { onDelete: 'set null' }),
    folderId: text('folder_id').references(() => folders.id, { onDelete: 'set null' }),
    visibility: text('visibility').$type<'private' | 'link' | 'public'>().notNull().default('private'),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    thumbnailHash: text('thumbnail_hash'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }).notNull().default(0),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
    deletedAt: ts('deleted_at'),
  },
  (t) => [
    index('projects_owner_idx').on(t.ownerId, t.updatedAt),
    index('projects_org_idx').on(t.orgId),
    index('projects_folder_idx').on(t.folderId),
    index('projects_deleted_idx').on(t.deletedAt),
  ],
)

export const shareLinks = pgTable(
  'share_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    /** sha256 of the token — the token itself is never stored. */
    tokenHash: text('token_hash').notNull().unique(),
    role: text('role').$type<'editor' | 'commenter' | 'viewer'>().notNull(),
    passwordHash: text('password_hash'),
    expiresAt: ts('expires_at'),
    uses: integer('uses').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('share_links_project_idx').on(t.projectId), index('share_links_expires_idx').on(t.expiresAt)],
)

/** Direct members (linkId null) and members who accepted a share link (linkId set; valid only while the link is). */
export const projectMembers = pgTable(
  'project_members',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').$type<'editor' | 'commenter' | 'viewer'>().notNull(),
    linkId: text('link_id').references(() => shareLinks.id, { onDelete: 'cascade' }),
    addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    unique('project_members_uq').on(t.projectId, t.userId, t.linkId).nullsNotDistinct(),
    index('project_members_user_idx').on(t.userId),
  ],
)

/** Pending invitations for e-mail addresses without a (verified) account. */
export const projectInvites = pgTable(
  'project_invites',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    email: text('email').notNull(),
    role: text('role').$type<'editor' | 'commenter' | 'viewer'>().notNull(),
    invitedBy: text('invited_by').references(() => user.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    expiresAt: ts('expires_at').notNull(),
  },
  (t) => [unique('project_invites_uq').on(t.projectId, t.email), index('project_invites_email_idx').on(t.email)],
)

export const orgProjectGrants = pgTable(
  'org_project_grants',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    orgId: text('org_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    role: text('role').$type<'editor' | 'commenter' | 'viewer'>().notNull(),
    addedBy: text('added_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.orgId] }), index('org_grants_org_idx').on(t.orgId)],
)

export const stars = pgTable(
  'stars',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] })],
)

export const recents = pgTable(
  'recents',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    openedAt: ts('opened_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.projectId] }), index('recents_user_idx').on(t.userId, t.openedAt)],
)

export const blobs = pgTable('blobs', {
  hash: text('hash').primaryKey(),
  size: bigint('size', { mode: 'number' }).notNull(),
  mime: text('mime').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
})

export const projectBlobs = pgTable(
  'project_blobs',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    hash: text('hash')
      .notNull()
      .references(() => blobs.hash, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.hash] }), index('project_blobs_hash_idx').on(t.hash)],
)

/** Per-user asset space (collection item blobs). */
export const userAssets = pgTable(
  'user_assets',
  {
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    hash: text('hash')
      .notNull()
      .references(() => blobs.hash, { onDelete: 'restrict' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.hash] }), index('user_assets_hash_idx').on(t.hash)],
)

export const collabDocs = pgTable(
  'collab_docs',
  {
    name: text('name').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    state: bytea('state').notNull(),
    encrypted: boolean('encrypted').notNull().default(false),
    size: integer('size').notNull().default(0),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collab_docs_project_idx').on(t.projectId), index('collab_docs_updated_idx').on(t.updatedAt)],
)

export const versions = pgTable(
  'versions',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    docName: text('doc_name').notNull(),
    name: text('name').notNull(),
    auto: boolean('auto').notNull().default(false),
    state: bytea('state').notNull(),
    encrypted: boolean('encrypted').notNull().default(false),
    size: integer('size').notNull().default(0),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('versions_project_doc_idx').on(t.projectId, t.docName, t.createdAt)],
)

export const collections = pgTable(
  'collections',
  {
    id: text('id').primaryKey(),
    ownerId: text('owner_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    orgId: text('org_id').references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('collections_owner_idx').on(t.ownerId), index('collections_org_idx').on(t.orgId)],
)

export const collectionItems = pgTable(
  'collection_items',
  {
    id: text('id').primaryKey(),
    collectionId: text('collection_id')
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: text('kind').$type<'object' | 'material' | 'component'>().notNull(),
    tags: jsonb('tags').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    thumbnail: text('thumbnail'),
    payload: jsonb('payload').$type<unknown>(),
    assets: jsonb('assets').$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('collection_items_collection_idx').on(t.collectionId)],
)

export const tickets = pgTable(
  'tickets',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    subject: text('subject').notNull(),
    status: text('status').$type<'open' | 'pending' | 'closed'>().notNull().default('open'),
    projectId: text('project_id').references(() => projects.id, { onDelete: 'set null' }),
    createdAt: ts('created_at').notNull().defaultNow(),
    updatedAt: ts('updated_at').notNull().defaultNow(),
  },
  (t) => [index('tickets_user_idx').on(t.userId), index('tickets_status_idx').on(t.status, t.updatedAt)],
)

export const ticketMessages = pgTable(
  'ticket_messages',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    authorId: text('author_id').references(() => user.id, { onDelete: 'set null' }),
    staff: boolean('staff').notNull().default(false),
    body: text('body').notNull(),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('ticket_messages_ticket_idx').on(t.ticketId, t.createdAt)],
)

/** User-granted, time-boxed, revocable read-only access for support staff. */
export const supportGrants = pgTable(
  'support_grants',
  {
    id: text('id').primaryKey(),
    ticketId: text('ticket_id')
      .notNull()
      .references(() => tickets.id, { onDelete: 'cascade' }),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    grantedBy: text('granted_by')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    expiresAt: ts('expires_at').notNull(),
    revokedAt: ts('revoked_at'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [index('support_grants_project_idx').on(t.projectId, t.expiresAt), index('support_grants_ticket_idx').on(t.ticketId)],
)

/** Security audit trail. No FKs: entries outlive users (actor data is anonymised on account deletion). */
export const auditLog = pgTable(
  'audit_log',
  {
    id: text('id').primaryKey(),
    actorId: text('actor_id'),
    actorEmail: text('actor_email'),
    action: text('action').notNull(),
    targetType: text('target_type'),
    targetId: text('target_id'),
    meta: jsonb('meta').$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    /** Truncated (/24, /48) — never the full address. */
    ip: text('ip'),
    createdAt: ts('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_created_idx').on(t.createdAt),
    index('audit_actor_idx').on(t.actorId, t.createdAt),
    index('audit_action_idx').on(t.action),
    index('audit_target_idx').on(t.targetType, t.targetId),
  ],
)

export const announcements = pgTable('announcements', {
  id: text('id').primaryKey(),
  message: text('message').notNull(),
  level: text('level').$type<'info' | 'warning' | 'critical'>().notNull(),
  startsAt: ts('starts_at').notNull().defaultNow(),
  endsAt: ts('ends_at'),
  createdBy: text('created_by').references(() => user.id, { onDelete: 'set null' }),
  createdAt: ts('created_at').notNull().defaultNow(),
})

/** GDPR Art. 17 — scheduled account deletions (grace period, cancellable). */
export const deletionRequests = pgTable('deletion_requests', {
  userId: text('user_id')
    .primaryKey()
    .references(() => user.id, { onDelete: 'cascade' }),
  requestedAt: ts('requested_at').notNull().defaultNow(),
  executeAfter: ts('execute_after').notNull(),
})

/** Operator-level settings edited in the admin panel (e.g. `legal.operator` — the imprint details). */
export const siteSettings = pgTable('site_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
  updatedBy: text('updated_by').references(() => user.id, { onDelete: 'set null' }),
})
