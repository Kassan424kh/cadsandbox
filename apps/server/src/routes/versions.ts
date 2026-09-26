// Version history + REST comments. Both operate on the live collab docs through Hocuspocus direct
// connections, so connected clients see restores/comments immediately and Yjs history is preserved.
import { createHash } from 'node:crypto'
import type { Hono } from 'hono'
import { and, count, eq } from 'drizzle-orm'
import { docNames, schemas } from '@cadsandbox/shared'
import type { CommentDef, CommentReply } from '@cadsandbox/doc'
import { versions } from '../db/schema'
import { newId } from '../lib/crypto'
import { badRequest, conflict, notFound } from '../lib/errors'
import { jsonBody, param, projectAccess, requireAuth, type AppEnv, type Ctx } from '../http/context'
import { jsonLimit, KB, register } from '../http/router'
import { addComment, addReply, restoreMapRoots, setResolved } from '../collab/ydoc'
import { audit } from '../services/audit'
import { createVersion, listVersions, versionDTO, versionState } from '../services/versions'

function docOfProject(docName: string, projectId: string, requireFile = false): string {
  const p = docNames.parse(docName)
  if (!p || p.projectId !== projectId || (requireFile && !p.fileId)) throw badRequest('docName does not belong to this project')
  return docName
}

/** Stable, readable author colour derived from the user id. */
export function colorFor(id: string): string {
  const h = createHash('sha256').update(id).digest()
  const hue = (h[0]! * 360) / 256
  const s = 0.65
  const l = 0.5
  const f = (n: number) => {
    const k = (n + hue / 30) % 12
    const c = l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k - 3, 9 - k, 1))
    return Math.round(c * 255)
      .toString(16)
      .padStart(2, '0')
  }
  return `#${f(0)}${f(8)}${f(4)}`
}

async function requireDoc(c: Ctx, docName: string): Promise<void> {
  if (!(await c.get('deps').collab.getState(docName))) throw notFound('Document not found')
}

const MAX_NAMED_VERSIONS = 100

export function versionRoutes(app: Hono<AppEnv>): void {
  register(app, 'listVersions', async (c) => {
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'view')
    const docName = c.req.query('docName')
    if (docName) docOfProject(docName, a.project.id)
    return c.json(await listVersions(d.db, a.project.id, docName))
  })

  register(app, 'createVersion', jsonLimit(8 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'edit')
    const input = await jsonBody(c, schemas.createVersion)
    const docName = docOfProject(input.docName, a.project.id)
    // Named versions are full snapshots that are never pruned automatically — keep them bounded.
    const [named] = await d.db.select({ n: count() }).from(versions).where(and(eq(versions.docName, docName), eq(versions.auto, false)))
    if (Number(named?.n ?? 0) >= MAX_NAMED_VERSIONS) throw conflict(`This file already has ${MAX_NAMED_VERSIONS} named versions — delete some first`)
    const state = await d.collab.getState(docName)
    if (!state) throw notFound('Document not found')
    const row = await createVersion(d.db, d.ring, { projectId: a.project.id, docName, name: input.name, auto: false, createdBy: s.user.id, state })
    return c.json(versionDTO(row, s.user.name), 201)
  })

  register(app, 'getVersion', async (c) => {
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'view')
    const [v] = await d.db
      .select()
      .from(versions)
      .where(and(eq(versions.id, param(c, 'versionId')), eq(versions.projectId, a.project.id)))
      .limit(1)
    if (!v) throw notFound('Version not found')
    const state = versionState(d.ring, v)
    return new Response(new Uint8Array(state), {
      headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(state.byteLength), 'Cache-Control': 'private, max-age=31536000, immutable' },
    })
  })

  register(app, 'restoreVersion', async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'edit')
    const [v] = await d.db
      .select()
      .from(versions)
      .where(and(eq(versions.id, param(c, 'versionId')), eq(versions.projectId, a.project.id)))
      .limit(1)
    if (!v) throw notFound('Version not found')
    const target = versionState(d.ring, v)
    // Safety net: snapshot the current state first, so a restore can itself be undone.
    const current = await d.collab.getState(v.docName)
    const backup = current
      ? await createVersion(d.db, d.ring, { projectId: a.project.id, docName: v.docName, name: `Before restoring "${v.name}"`.slice(0, 120), auto: false, createdBy: s.user.id, state: current })
      : null
    let changed = 0
    await d.collab.transact(v.docName, (doc) => {
      changed = restoreMapRoots(doc, target).changedKeys
    })
    await audit(d.db, { actorId: s.user.id, actorEmail: s.user.email, action: 'project.version.restore', targetType: 'project', targetId: a.project.id, ip: c.get('ip'), meta: { versionId: v.id, docName: v.docName, changedKeys: changed } }, d.log)
    return c.json({ ok: true, changedKeys: changed, backupVersionId: backup?.id ?? null })
  })

  // ---------------------------------------------------------------- comments (commenter+)
  register(app, 'addComment', jsonLimit(32 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'comment')
    const input = await jsonBody(c, schemas.addComment)
    const docName = docOfProject(input.docName, a.project.id, true)
    await requireDoc(c, docName)
    const comment: CommentDef = {
      id: newId(),
      author: { id: s.user.id, name: s.user.name, color: colorFor(s.user.id) },
      text: input.text,
      createdAt: Date.now(),
      anchor: { ...input.anchor },
      resolved: false,
      replies: [],
    }
    await d.collab.transact(docName, (doc) => addComment(doc, comment))
    return c.json({ id: comment.id }, 201)
  })

  register(app, 'replyComment', jsonLimit(32 * KB), async (c) => {
    const s = requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'comment')
    const input = await jsonBody(c, schemas.replyComment)
    const docName = docOfProject(input.docName, a.project.id, true)
    const commentId = param(c, 'commentId')
    await requireDoc(c, docName)
    const reply: CommentReply = { id: newId(), author: { id: s.user.id, name: s.user.name, color: colorFor(s.user.id) }, text: input.text, createdAt: Date.now() }
    let found = false
    await d.collab.transact(docName, (doc) => {
      found = addReply(doc, commentId, reply)
    })
    if (!found) throw notFound('Comment not found')
    return c.json({ id: reply.id }, 201)
  })

  register(app, 'resolveComment', jsonLimit(8 * KB), async (c) => {
    requireAuth(c)
    const d = c.get('deps')
    const a = await projectAccess(c, param(c, 'id'), 'comment')
    const input = await jsonBody(c, schemas.resolveComment)
    const docName = docOfProject(input.docName, a.project.id, true)
    const commentId = param(c, 'commentId')
    await requireDoc(c, docName)
    let found = false
    await d.collab.transact(docName, (doc) => {
      found = setResolved(doc, commentId, input.resolved)
    })
    if (!found) throw notFound('Comment not found')
    return c.json({ ok: true, resolved: input.resolved })
  })
}
