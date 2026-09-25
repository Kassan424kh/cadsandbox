// GDPR Art. 15/20 export — a streamed ZIP with everything we store about/for the user:
// profile, sessions, orgs, folders, owned projects (metadata, collab docs as Yjs binary + JSON dump,
// version list, blobs), memberships, collections + assets, tickets, stars, audit entries.
import { once } from 'node:events'
import { PassThrough, Readable } from 'node:stream'
import { and, desc, eq, inArray, or } from 'drizzle-orm'
import { Zip, ZipDeflate, ZipPassThrough } from 'fflate'
import {
  account,
  auditLog,
  blobs,
  collectionItems,
  collections,
  deletionRequests,
  folders,
  invitation,
  orgProjectGrants,
  passkey,
  projectBlobs,
  projectMembers,
  projects,
  session,
  shareLinks,
  stars,
  supportGrants,
  ticketMessages,
  tickets,
  user,
  userAssets,
  versions,
} from '../db/schema'
import type { Deps } from '../deps'
import { dumpDoc } from '../collab/ydoc'
import { projectDocNames } from './projects'
import { orgsOfUser } from './orgs'
import { toUserDTO } from './users'

/** fflate has no ZIP64: keep the archive safely below 4 GiB. */
const MAX_BLOB_BYTES_IN_ZIP = 3.5 * 1024 ** 3

const README = `CadSandbox — export of your personal data (GDPR Art. 15 & 20)

profile.json        account, sessions (IP truncated), passkeys (metadata), 2FA status
organizations.json  organisations you belong to, pending invitations
folders.json        your folders
projects/           every project you own:
  <id>/project.json   metadata, members, share links (tokens are never stored), org grants
  <id>/docs/*.yjs     collaborative documents (Yjs update format — open with CadSandbox or any Yjs tool)
  <id>/docs/*.json    the same documents as readable JSON
  <id>/versions.json  version history metadata
  <id>/blobs/<sha256> uploaded files (textures, models, images) by content hash
memberships.json    projects others shared with you (metadata only)
collections.json    your library collections and items; assets/ holds their files
tickets.json        your support tickets, messages and support-access grants
activity.json       stars and security audit entries concerning you
`

const safeName = (s: string) => s.replace(/[^\w.-]+/g, '_')

export async function exportUserData(d: Deps, userId: string): Promise<ReadableStream<Uint8Array>> {
  const out = new PassThrough({ highWaterMark: 1 << 20 })
  const zip = new Zip((err, chunk, final) => {
    if (err) return void out.destroy(err)
    if (chunk.length) out.write(chunk)
    if (final) out.end()
  })
  const drain = async () => {
    if (out.writableNeedDrain) await once(out, 'drain')
  }
  const addJson = async (name: string, value: unknown) => {
    const f = new ZipDeflate(name, { level: 6 })
    zip.add(f)
    f.push(Buffer.from(JSON.stringify(value, null, 2)), true)
    await drain()
  }
  const addBytes = async (name: string, data: Uint8Array) => {
    const f = new ZipPassThrough(name)
    zip.add(f)
    f.push(data, true)
    await drain()
  }
  const addStream = async (name: string, stream: Readable) => {
    const f = new ZipPassThrough(name)
    zip.add(f)
    for await (const chunk of stream) {
      f.push(chunk as Uint8Array)
      await drain()
    }
    f.push(new Uint8Array(0), true)
  }

  const run = async () => {
    const db = d.db
    const [u] = await db.select().from(user).where(eq(user.id, userId)).limit(1)
    if (!u) throw new Error('user not found')
    await addBytes('README.txt', Buffer.from(README))

    const [accounts, sessions, keys, del] = await Promise.all([
      db.select({ providerId: account.providerId, createdAt: account.createdAt, updatedAt: account.updatedAt }).from(account).where(eq(account.userId, userId)),
      db
        .select({ createdAt: session.createdAt, updatedAt: session.updatedAt, expiresAt: session.expiresAt, ipAddress: session.ipAddress, userAgent: session.userAgent, impersonatedBy: session.impersonatedBy })
        .from(session)
        .where(eq(session.userId, userId)),
      db.select({ name: passkey.name, createdAt: passkey.createdAt, deviceType: passkey.deviceType, backedUp: passkey.backedUp }).from(passkey).where(eq(passkey.userId, userId)),
      db.select().from(deletionRequests).where(eq(deletionRequests.userId, userId)),
    ])
    await addJson('profile.json', { user: { ...toUserDTO(u), banned: u.banned, banReason: u.banReason }, accounts, sessions, passkeys: keys, deletionRequest: del[0] ?? null })

    const [orgs, orgInvites] = await Promise.all([orgsOfUser(db, userId), db.select().from(invitation).where(eq(invitation.email, u.email.toLowerCase()))])
    await addJson('organizations.json', { organizations: orgs, invitations: orgInvites.map((i) => ({ organizationId: i.organizationId, role: i.role, status: i.status, expiresAt: i.expiresAt })) })
    await addJson('folders.json', await db.select().from(folders).where(eq(folders.ownerId, userId)))

    const owned = await db.select().from(projects).where(eq(projects.ownerId, userId))
    let blobBudget = MAX_BLOB_BYTES_IN_ZIP
    const omitted: { projectId?: string; hash: string; size: number }[] = []
    for (const p of owned) {
      const base = `projects/${safeName(p.id)}`
      const [members, links, grants, vers, refs] = await Promise.all([
        db.select({ userId: projectMembers.userId, role: projectMembers.role, viaLink: projectMembers.linkId, createdAt: projectMembers.createdAt }).from(projectMembers).where(eq(projectMembers.projectId, p.id)),
        db.select({ id: shareLinks.id, role: shareLinks.role, hasPassword: shareLinks.passwordHash, expiresAt: shareLinks.expiresAt, uses: shareLinks.uses, createdAt: shareLinks.createdAt }).from(shareLinks).where(eq(shareLinks.projectId, p.id)),
        db.select().from(orgProjectGrants).where(eq(orgProjectGrants.projectId, p.id)),
        db.select({ id: versions.id, docName: versions.docName, name: versions.name, auto: versions.auto, size: versions.size, createdAt: versions.createdAt }).from(versions).where(eq(versions.projectId, p.id)).orderBy(desc(versions.createdAt)),
        db.select({ hash: blobs.hash, size: blobs.size, mime: blobs.mime, encrypted: blobs.encrypted }).from(projectBlobs).innerJoin(blobs, eq(blobs.hash, projectBlobs.hash)).where(eq(projectBlobs.projectId, p.id)),
      ])
      await addJson(`${base}/project.json`, { project: p, members, shareLinks: links.map((l) => ({ ...l, hasPassword: !!l.hasPassword })), orgGrants: grants })
      await addJson(`${base}/versions.json`, vers)
      for (const name of await projectDocNames(db, p.id, d.collab.liveDocNames(p.id))) {
        const state = await d.collab.getState(name)
        if (!state) continue
        await addBytes(`${base}/docs/${safeName(name)}.yjs`, state)
        await addJson(`${base}/docs/${safeName(name)}.json`, dumpDoc(state))
      }
      for (const b of refs) {
        if (b.size > blobBudget) {
          omitted.push({ projectId: p.id, hash: b.hash, size: b.size })
          continue
        }
        const s = await d.blobs.get(b.hash, b.encrypted)
        if (!s) continue
        blobBudget -= b.size
        await addStream(`${base}/blobs/${b.hash}`, s)
      }
    }

    const shared = await db
      .select({ projectId: projects.id, name: projects.name, role: projectMembers.role, since: projectMembers.createdAt })
      .from(projectMembers)
      .innerJoin(projects, eq(projects.id, projectMembers.projectId))
      .where(eq(projectMembers.userId, userId))
    await addJson('memberships.json', shared)

    const cols = await db.select().from(collections).where(eq(collections.ownerId, userId))
    const items = cols.length
      ? await db
          .select()
          .from(collectionItems)
          .where(
            inArray(
              collectionItems.collectionId,
              cols.map((c) => c.id),
            ),
          )
      : []
    await addJson('collections.json', { collections: cols, items })
    const assets = await db.select({ hash: blobs.hash, size: blobs.size, encrypted: blobs.encrypted }).from(userAssets).innerJoin(blobs, eq(blobs.hash, userAssets.hash)).where(eq(userAssets.userId, userId))
    for (const a of assets) {
      if (a.size > blobBudget) {
        omitted.push({ hash: a.hash, size: a.size })
        continue
      }
      const s = await d.blobs.get(a.hash, a.encrypted)
      if (!s) continue
      blobBudget -= a.size
      await addStream(`assets/${a.hash}`, s)
    }

    const myTickets = await db.select().from(tickets).where(eq(tickets.userId, userId))
    const ticketIds = myTickets.map((t) => t.id)
    const [msgs, grants] = ticketIds.length
      ? await Promise.all([
          db.select({ ticketId: ticketMessages.ticketId, staff: ticketMessages.staff, body: ticketMessages.body, createdAt: ticketMessages.createdAt }).from(ticketMessages).where(inArray(ticketMessages.ticketId, ticketIds)),
          db.select().from(supportGrants).where(inArray(supportGrants.ticketId, ticketIds)),
        ])
      : [[], []]
    await addJson('tickets.json', { tickets: myTickets, messages: msgs, supportGrants: grants })

    const [myStars, auditRows] = await Promise.all([
      db.select().from(stars).where(eq(stars.userId, userId)),
      db
        .select()
        .from(auditLog)
        .where(or(eq(auditLog.actorId, userId), and(eq(auditLog.targetType, 'user'), eq(auditLog.targetId, userId))))
        .orderBy(desc(auditLog.createdAt))
        .limit(10_000),
    ])
    await addJson('activity.json', { stars: myStars, audit: auditRows })
    if (omitted.length) await addJson('blobs-not-included.json', { reason: 'Archive size limit (3.5 GiB). Download these files from the app or contact support.', files: omitted })
    zip.end()
  }

  run().catch((err: unknown) => {
    d.log.error({ err: (err as Error).message }, 'data export failed')
    zip.terminate()
    out.destroy(err as Error)
  })
  return Readable.toWeb(out) as unknown as ReadableStream<Uint8Array>
}
