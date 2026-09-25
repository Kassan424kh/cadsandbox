// Background jobs (interval scheduler, no overlap; on Postgres one instance runs each job via an
// advisory lock): trash purge, due account deletions, audit retention, expiries, blob GC, auto versions.
import { and, eq, isNotNull, lt, lte, ne, sql } from 'drizzle-orm'
import { LIMITS } from '@cadsandbox/shared'
import { rowsOf } from '../db/client'
import { auditLog, blobs, deletionRequests, invitation, projectInvites, projects, session, shareLinks, supportGrants, user, verification } from '../db/schema'
import type { Deps } from '../deps'
import { pickLocale } from '../mail/templates'
import { audit } from '../services/audit'
import { hardDeleteProjects } from '../services/projects'
import { hardDeleteUser } from '../services/users'
import { createVersion, pruneAutoVersions } from '../services/versions'

const MIN = 60_000
const HOUR = 60 * MIN
const DAY = 24 * HOUR

export interface Job {
  name: string
  everyMs: number
  run(d: Deps): Promise<void>
}

export const jobs: Job[] = [
  {
    name: 'purge-trash',
    everyMs: HOUR,
    async run(d) {
      const cutoff = new Date(Date.now() - LIMITS.trashRetentionDays * DAY)
      const due = await d.db.select({ id: projects.id }).from(projects).where(and(isNotNull(projects.deletedAt), lt(projects.deletedAt, cutoff))).limit(200)
      if (!due.length) return
      await hardDeleteProjects(
        d,
        due.map((p) => p.id),
      )
      await audit(d.db, { action: 'system.trash.purge', meta: { projects: due.length } }, d.log)
    },
  },
  {
    name: 'account-deletions',
    everyMs: 15 * MIN,
    async run(d) {
      const due = await d.db
        .select({ userId: deletionRequests.userId, email: user.email, locale: user.locale })
        .from(deletionRequests)
        .innerJoin(user, eq(user.id, deletionRequests.userId))
        .where(lte(deletionRequests.executeAfter, new Date()))
        .limit(50)
      for (const r of due) {
        const result = await hardDeleteUser(d.db, d.events, r.userId, d.log)
        await audit(d.db, { action: 'account.deleted', meta: { projects: result?.projects.length ?? 0 } }, d.log)
        d.mailer.queue(r.email, { kind: 'accountDeleted' }, pickLocale(r.locale))
      }
    },
  },
  {
    name: 'purge-audit',
    everyMs: DAY,
    async run(d) {
      await d.db.delete(auditLog).where(lt(auditLog.createdAt, new Date(Date.now() - LIMITS.auditRetentionDays * DAY)))
    },
  },
  {
    name: 'expire',
    everyMs: 15 * MIN,
    async run(d) {
      const now = new Date()
      const links = await d.db.delete(shareLinks).where(lt(shareLinks.expiresAt, now)).returning({ projectId: shareLinks.projectId })
      for (const pid of new Set(links.map((l) => l.projectId))) d.events.projectChanged(pid)
      const grants = await d.db
        .update(supportGrants)
        .set({ revokedAt: now })
        .where(and(lt(supportGrants.expiresAt, now), sql`${supportGrants.revokedAt} IS NULL`))
        .returning({ projectId: supportGrants.projectId })
      for (const pid of new Set(grants.map((g) => g.projectId))) d.events.projectChanged(pid)
      await d.db.delete(supportGrants).where(lt(supportGrants.expiresAt, new Date(now.getTime() - 90 * DAY)))
      await d.db.delete(projectInvites).where(lt(projectInvites.expiresAt, now))
      await d.db.delete(session).where(lt(session.expiresAt, now))
      await d.db.delete(verification).where(lt(verification.expiresAt, now))
      await d.db.delete(invitation).where(and(lt(invitation.expiresAt, now), eq(invitation.status, 'pending')))
      await d.db.delete(invitation).where(and(ne(invitation.status, 'pending'), lt(invitation.createdAt, new Date(now.getTime() - 90 * DAY))))
    },
  },
  {
    name: 'blob-gc',
    everyMs: 6 * HOUR,
    async run(d) {
      const res = await d.db.execute(sql`SELECT b.hash FROM blobs b
        WHERE b.created_at < now() - interval '1 day'
          AND NOT EXISTS (SELECT 1 FROM project_blobs pb WHERE pb.hash = b.hash)
          AND NOT EXISTS (SELECT 1 FROM user_assets ua WHERE ua.hash = b.hash)
          AND NOT EXISTS (SELECT 1 FROM projects p WHERE p.thumbnail_hash = b.hash)
        LIMIT 500`)
      let removed = 0
      for (const { hash } of rowsOf<{ hash: string }>(res)) {
        try {
          // FK "restrict" makes this fail if a reference appeared concurrently — then we keep it.
          const del = await d.db.delete(blobs).where(eq(blobs.hash, hash)).returning({ hash: blobs.hash })
          if (!del.length) continue
          await d.blobs.delete(hash)
          removed++
        } catch {
          /* referenced again — skip */
        }
      }
      if (removed) d.log.info({ removed }, 'blob gc')
    },
  },
  {
    name: 'auto-versions',
    everyMs: HOUR,
    async run(d) {
      const res = await d.db.execute(sql`SELECT cd.name, cd.project_id FROM collab_docs cd
        JOIN projects p ON p.id = cd.project_id AND p.deleted_at IS NULL
        WHERE cd.updated_at > now() - interval '2 hours'
          AND cd.updated_at > COALESCE((SELECT max(v.created_at) FROM versions v WHERE v.doc_name = cd.name), 'epoch'::timestamptz)
        LIMIT 500`)
      const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ')
      for (const r of rowsOf<{ name: string; project_id: string }>(res)) {
        const state = await d.collab.getState(r.name)
        if (!state) continue
        await createVersion(d.db, d.ring, { projectId: r.project_id, docName: r.name, name: `Auto-save ${stamp} UTC`, auto: true, createdBy: null, state })
      }
      await pruneAutoVersions(d.db)
    },
  },
]

export interface Scheduler {
  run(name: string): Promise<void>
  stop(): Promise<void>
}

export function startScheduler(d: Deps, opts: { autoStart: boolean }): Scheduler {
  const running = new Map<string, Promise<void>>()
  const timers: NodeJS.Timeout[] = []

  const exec = async (job: Job) => {
    if (running.has(job.name)) return running.get(job.name)
    const p = (async () => {
      const started = Date.now()
      try {
        if (d.dbDriver === 'pg') {
          await d.db.transaction(async (tx) => {
            const got = rowsOf<{ ok: boolean }>(await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext(${`cadsandbox-job:${job.name}`})) AS ok`))[0]?.ok
            if (got) await job.run(d)
          })
        } else await job.run(d)
        d.log.debug({ job: job.name, ms: Date.now() - started }, 'job done')
      } catch (err) {
        d.log.error({ job: job.name, err: (err as Error).message }, 'job failed')
      } finally {
        running.delete(job.name)
      }
    })()
    running.set(job.name, p)
    return p
  }

  if (opts.autoStart) {
    jobs.forEach((job, i) => {
      // Stagger first runs so startup stays quick.
      const first = setTimeout(() => void exec(job), 30_000 + i * 5_000)
      const every = setInterval(() => void exec(job), job.everyMs)
      first.unref()
      every.unref()
      timers.push(first, every)
    })
  }

  return {
    async run(name) {
      const job = jobs.find((j) => j.name === name)
      if (!job) throw new Error(`unknown job ${name}`)
      await exec(job)
    },
    async stop() {
      for (const t of timers) clearTimeout(t)
      await Promise.allSettled([...running.values()])
    },
  }
}

