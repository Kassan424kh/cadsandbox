# Löschkonzept / Retention schedule

Implemented by the background jobs in `apps/server/src/jobs/scheduler.ts` (constants in
`LIMITS`, `@cadsandbox/shared`) unless marked *operational*.

| Data | Retention | Deletion mechanism |
|---|---|---|
| Account (profile, sessions, 2FA, passkeys, memberships, folders, owned projects, collections, assets, tickets) | until deletion request + **7-day grace** (cancellable) | job `account-deletions` → hard delete (DB cascades); audit actor anonymised |
| Projects in trash | **30 days** after trashing | job `purge-trash` → hard delete incl. collab docs, versions, links, members, blob refs |
| Blobs (files) | while referenced by a project, asset space or thumbnail | job `blob-gc` removes unreferenced blobs after 1 day grace |
| Collab documents | lifetime of the project | cascade with project |
| Auto versions | newest **50 per document** | job `auto-versions` prunes older ones |
| Named versions | lifetime of the project | cascade with project |
| Sessions | **30 days** rolling (expire after inactivity), impersonation sessions 1 h | job `expire` deletes expired sessions |
| E-mail verification / password reset tokens | 24 h / 1 h | job `expire` |
| Share links | until deleted or expiry date | job `expire` deletes expired links (and the memberships gained through them) |
| Project invitations (pending) | **30 days** | job `expire` |
| Organisation invitations | 7 days pending; processed ones 90 days | job `expire` |
| Support access grants | 1–30 days as granted; record deleted 90 days after expiry | revoked on expiry/close/revoke; job `expire` |
| Support tickets & messages | lifetime of the account | cascade with account |
| Audit log | **365 days** | job `purge-audit` |
| Rate-limit counters | ≤ 1 h, memory only | window expiry / restart |
| Application & proxy logs | rotation at 5 × 10 MB per service (typically days) | Docker log rotation (*operational*) |
| Backups — database dumps | 7 daily, 4 weekly, 6 monthly (oldest ≈ 6 months) | `backup` service (`apps/server/deploy/backup.sh`): `restic forget --prune` after every run (*operational*, encrypted, off-site) |
| Backups — file mirror (blobs) | mirror of the live bucket; objects removed by `blob-gc` stay **190 days** in `deleted/<date>/` (≈ 6 months) | `backup` service: `rclone sync --backup-dir` + dated purge (*operational*, encrypted, off-site) |
| Data export ZIP | not stored (streamed on request) | — |
| Local browser data (no account) | until the user clears it | user-controlled (IndexedDB) |
