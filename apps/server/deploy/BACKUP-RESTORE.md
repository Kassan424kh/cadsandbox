# CadSandbox — Backup & Restore Runbook (Dokploy layout)

Applies to `docker-compose.dokploy.yml` (app containers stateless; data in a shared PostgreSQL and an
S3/MinIO bucket). The `backup` service (image `apps/server/deploy/backup.Dockerfile`, scripts
`backup.sh` / `restore.sh` in this directory) produces **encrypted, off-site** backups at a **second EU
provider** and this document describes how to monitor them and how to rehearse a restore every quarter.

## 1. What is backed up, and how

| Data | Mechanism | Where | Encryption |
|---|---|---|---|
| PostgreSQL database (`DATABASE_URL`) | `pg_dump --format=custom` streamed by `restic backup --stdin-from-command` — never written to a local disk; restic creates **no snapshot** if `pg_dump` fails | restic repository `RESTIC_REPOSITORY` (default `s3:<BACKUP_S3_ENDPOINT>/<BACKUP_S3_BUCKET>/restic`) | restic: AES-256-CTR + Poly1305-AES, key derived from `RESTIC_PASSWORD` (client side) |
| Manifest per run (exact row count of every table, DB size, blob object count/bytes at source and in the mirror) | second restic snapshot of the same run (tag `manifest`, tag `run-<id>`) | same repository | same |
| Blob bucket (`S3_BUCKET`/`S3_PREFIX`, keys `ab/cd/<sha256>[.enc]`) | `rclone sync --size-only --backup-dir` into an **rclone crypt** remote: objects removed by the app's GC are moved to `deleted/<YYYY-MM-DD>/` and purged after `BACKUP_BLOB_DELETED_KEEP_DAYS` (190) | `<BACKUP_S3_BUCKET>/<BACKUP_BLOB_PATH>/` (`current/`, `deleted/<date>/`) | rclone crypt: XSalsa20-Poly1305, encrypted file **and directory names**, key derived from `BACKUP_BLOB_PASSWORD` (defaults to `RESTIC_PASSWORD`) |
| Blob directory of a `STORAGE_DRIVER=local` layout *(optional)* | `restic backup` of `BACKUP_LOCAL_BLOBS_DIR` (mount the volume read-only) | restic repository | restic |

Retention: `restic forget --prune --keep-daily 7 --keep-weekly 4 --keep-monthly 6` after every run
(so the oldest dump is ~6 months old); the blob mirror always equals the live bucket plus everything
deleted in the last 190 days, which is what any dump of the last 6 months can reference. `restic
check --read-data-subset=10%` runs weekly (`BACKUP_CHECK_SCHEDULE`).

**Why restic for the database but rclone for the blobs.** Blobs are content-addressed and immutable
(the key *is* the sha256 of the content; the only mutation is the GC deleting unreferenced objects),
so restic's chunking and deduplication add nothing, while a restic snapshot of the bucket would need a
full local mirror on the host (restic reads file systems, not buckets) or a full download every day.
`rclone sync` copies object-to-object, lists once, transfers only new keys and needs no disk. The app's
own AES-256-GCM (`STORAGE_ENCRYPTION_KEY`) is optional, therefore the copy is encrypted by rclone
regardless — the backup provider never sees names or contents. `--backup-dir` + the dated purge
gives the 6-month deletion horizon without relying on provider features (bucket versioning and
lifecycle rules can be enabled additionally). The database, in contrast, benefits from restic: a
compact stream, snapshots with a proper 7/4/6 policy, `check`, and `--stdin-from-command` guarding
against truncated dumps.

**Nothing is kept on the application host.** The previous plaintext `pg_dump` volume was removed: a
copy next to the database does not survive the host and would need its own key handling; restoring
the newest dump from the off-site repository takes seconds for a database of this size.

## 2. Environment (Dokploy → Environment)

Required for backups (the app deploy does **not** break without them — the `backup` container logs
`configuration incomplete`, stays unhealthy and retries hourly):

| Variable | Meaning |
|---|---|
| `BACKUP_S3_ENDPOINT` | S3 endpoint of the **second** EU provider (e.g. `https://s3.<region>.<provider>.eu`) — separate account, separate credentials, bucket created there beforehand |
| `BACKUP_S3_BUCKET` | bucket at that provider; receives `restic/` and `blobs/` |
| `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY` | key scoped to that bucket (read/write/delete/list) |
| `RESTIC_PASSWORD` | `openssl rand -base64 32`. **Keep an offline copy** (password manager + vault): without it every backup is unreadable |

Already present for the app and reused as the source: `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`,
`S3_REGION`, `S3_PREFIX`, `S3_FORCE_PATH_STYLE`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Optional:

| Variable | Default | Meaning |
|---|---|---|
| `BACKUP_HEARTBEAT_URL` | – | Uptime Kuma push URL (`…/api/push/<token>?…`) or healthchecks.io-style ping URL; success → up / ping, failure → down / `/fail` |
| `BACKUP_SCHEDULE` | `15 3 * * *` | cron (5 fields) in `BACKUP_TZ` (`UTC`) |
| `BACKUP_CHECK_SCHEDULE` | `45 4 * * 0` | weekly `restic check`; `never` disables |
| `BACKUP_KEEP_DAILY` / `_WEEKLY` / `_MONTHLY` | `7` / `4` / `6` | restic retention |
| `BACKUP_BLOB_DELETED_KEEP_DAYS` | `190` | how long GC-deleted blobs stay in the mirror |
| `BACKUP_BLOBS` | `true` | `false` skips the blob mirror |
| `BACKUP_BLOB_PATH` | `blobs` | prefix of the mirror inside `BACKUP_S3_BUCKET` |
| `BACKUP_BLOB_PASSWORD` | `RESTIC_PASSWORD` | separate passphrase for the blob mirror |
| `RESTIC_REPOSITORY` | `s3:<endpoint>/<bucket>/restic` | any restic backend URL |
| `BACKUP_S3_REGION` / `BACKUP_S3_PROVIDER` / `BACKUP_S3_FORCE_PATH_STYLE` | `eu-central-1` / `Other` / `true` | rclone S3 settings of the target (`Minio`, `Scaleway`, `IONOS`, … for provider-specific behaviour) |
| `BACKUP_SOURCE_S3_ACCESS_KEY_ID` / `_SECRET_ACCESS_KEY` | app's key | a **read-only** key for the source bucket (recommended) |
| `S3_RCLONE_PROVIDER` | `Other` | rclone provider name of the source (`Minio`) |
| `BACKUP_RUN_ON_START` | `false` | run once when the container starts (first deploy, tests) |
| `BACKUP_MAX_AGE_HOURS` | `26` | container turns unhealthy when the last success is older |
| `BACKUP_CHECK_READ_SUBSET` | `10%` | data sample verified by `restic check` |
| `BACKUP_MEM_LIMIT` / `BACKUP_CPUS` | `1g` / `1` | container limits (rclone `--fast-list` holds the object list in memory: ~1 GB per million objects) |
| `BACKUP_LOCAL_BLOBS_DIR` | – | directory to include with restic (local blob layouts) |

Build arguments of `backup.Dockerfile`: `ALPINE_VERSION=3.22`, `PG_MAJOR=17` — `pg_dump` must be at
least as new as the PostgreSQL server (bump both when the server moves to a newer major).

## 3. First-time setup

1. At the second provider: create the bucket, a key limited to it, note endpoint/region. Sign the DPA
   and add the provider to `docs/gdpr/subprocessors.md` and the privacy policy placeholders.
2. Generate `RESTIC_PASSWORD`, store it offline; set the variables above in Dokploy; redeploy.
3. On the host (compose project directory = Dokploy's checkout of this repo; `<app>` = the compose's app name):

   ```bash
   docker compose -p <app> -f ./docker-compose.dokploy.yml logs backup          # "configuration OK … schedule …"
   docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup run  # first backup now
   docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup snapshots
   ```

   The first run initializes the restic repository ("no repository … initializing") and copies the
   whole bucket; later runs transfer only the delta.
4. Create the monitor: Uptime Kuma → *Push* monitor, heartbeat interval **93600 s (26 h)**, retries 0,
   paste its URL into `BACKUP_HEARTBEAT_URL` (or a healthchecks.io check with period 1 day, grace 2 h).
   Test by setting a wrong `RESTIC_PASSWORD` in a `run` and watching the alert.
5. Remove the old plaintext dump volume once the first off-site backup exists:
   `docker volume rm <app>_backups`.

## 4. Monitoring and failure handling

- Every run logs `BACKUP OK — run <id> finished in <n>s` or `BACKUP FAILED at step '<step>'`; the
  process exits 1 on failure (`run`) and the container healthcheck reports **unhealthy** after a failed
  run or when the last success is older than 26 h (`docker ps`, Dokploy).
- The heartbeat monitor alerts when no success arrives within 26 h (or immediately on `/fail`/`down`).
- Steps and typical causes: `restic-init`/`db-dump` — target unreachable, wrong credentials or
  `RESTIC_PASSWORD`; `db-dump` "server version mismatch" — raise `PG_MAJOR`; `blobs-sync` — source key
  lacks list permission or provider needs `S3_RCLONE_PROVIDER=Minio`; `restic-forget` "repository is
  already locked" — a crashed run's lock, removed automatically after 30 min or with
  `run --rm backup restic unlock`.
- `restic check` failures (weekly) also trigger the failure heartbeat.

## 5. Quarterly restore drill (≈ 30 minutes)

Rehearse in the first week of every quarter; record date, snapshot id, duration, deviations in the
operations log (this closes the "Wiederherstellungstest" checkbox in `docs/gdpr/toms.md`).

1. **Pick a snapshot.**
   `docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup snapshots`
   Note the `db` snapshot id and its date (alternate between *latest* and a weekly/monthly one).
2. **Create an empty database** on the shared PostgreSQL (admin `psql`):
   `CREATE DATABASE restore_cadsandbox OWNER cadsandbox;` — never restore into the live database;
   `restore.sh` refuses `DATABASE_URL` and non-empty databases.
3. **Restore + verify the database:**

   ```bash
   docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup \
     restore db --to 'postgres://cadsandbox:<password>@<host>:5432/restore_cadsandbox' --snapshot <id>
   ```

   `pg_restore` runs with `--no-owner --no-privileges`; afterwards every table's row count is compared
   with the run's manifest and printed (`ok` / `MISMATCH`). Exit code 0 = all tables match.
4. **Restore the blobs into a scratch bucket/prefix** on the app's S3 (create `cadsandbox-restore` in
   MinIO first):

   ```bash
   docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup \
     restore blobs --to cadsandbox-restore/blobs --as-of <date of the dump, YYYY-MM-DD>
   ```

   `--as-of` also copies objects the GC removed on/after that date, so every blob referenced by that
   dump exists. (For a full drill; a partial one may verify against the mirror directly, see 5.)
5. **Spot-check content addresses** — 10 random blobs listed in the restored database, re-hashed:

   ```bash
   docker compose -p <app> -f ./docker-compose.dokploy.yml run --rm backup \
     restore verify-blobs --to 'postgres://…/restore_cadsandbox' --in cadsandbox-restore/blobs --count 10
   # or against the off-site mirror without step 4:  … restore verify-blobs --to 'postgres://…' --count 10
   ```

   Plaintext objects must hash to their key; objects the app encrypted (`.enc`) are checked for the
   `CSS1` header and the exact ciphertext size — reading them needs `STORAGE_ENCRYPTION_KEY`, which is
   why that key (and `STORAGE_ENCRYPTION_OLD_KEYS`) must be escrowed together with `RESTIC_PASSWORD`.
6. **Optional end-to-end check:** start a throw-away app container against the restored data — with
   plain `docker run`, **not** `docker compose run app` (that would carry the Traefik labels and join
   the production router):

   ```bash
   docker run --rm --name cadsandbox-restore-check -p 127.0.0.1:8788:8787 --network dokploy-network \
     --env-file .env -e NODE_ENV=development -e PUBLIC_URL=http://localhost:8788 -e TRUST_PROXY=false \
     -e DATABASE_URL='postgres://…/restore_cadsandbox' -e S3_BUCKET=cadsandbox-restore cadsandbox-app:latest
   curl -fsS http://127.0.0.1:8788/api/health   # then sign in via an SSH tunnel and open a project
   ```

   `.env` supplies the production `STORAGE_ENCRYPTION_KEY` / `BETTER_AUTH_SECRET`; the `-e` flags
   override the data locations. Stop the container afterwards (`docker stop cadsandbox-restore-check`).
7. **Clean up:** `DROP DATABASE restore_cadsandbox;`, delete the `cadsandbox-restore` bucket.
8. **Record** the result; open an issue for any `MISMATCH`, `CORRUPT` or `MISSING` line.

## 6. Disaster recovery (new host / lost database or bucket)

1. Provision PostgreSQL + MinIO (or another S3) and create an empty database and bucket.
2. Run the restore from any machine with Docker and the repository checked out (only the `BACKUP_*`,
   `RESTIC_*` and the *new* `S3_*` variables are needed — `docker compose run --rm -e … backup restore …`):
   `restore db --to <new DATABASE_URL>` and `restore blobs --to <new bucket>/blobs --as-of <dump date>`.
3. Deploy the app with `DATABASE_URL` / `S3_*` pointing at the restored data and the **same**
   `STORAGE_ENCRYPTION_KEY`, `STORAGE_ENCRYPTION_OLD_KEYS` and `BETTER_AUTH_SECRET`. Migrations newer
   than the dump are applied at startup.
4. Re-enable the backup service against the same repository (it appends snapshots).

Without Docker: `restic` (≥ 0.16), `rclone` (≥ 1.60) and `pg_restore` work with the same variables;
the rclone remotes are described by the `RCLONE_CONFIG_*` exports in `backup.sh` (`rclone_setup`).

## 7. Keys to escrow (offline, two locations)

`RESTIC_PASSWORD`, `BACKUP_BLOB_PASSWORD` (if set), `STORAGE_ENCRYPTION_KEY` + `_OLD_KEYS`,
`BETTER_AUTH_SECRET`, the off-site provider credentials. Losing the first two makes the backups
worthless; losing the storage key makes encrypted blobs and collaboration documents unreadable.
