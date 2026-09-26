# CadSandbox — Deployment (EU)

One Docker image serves the web app, the API (`/api`) and real-time collaboration (`/collab`).
The reference setup runs on a single EU VM with Docker Compose: **Caddy** (TLS) → **app** →
**Postgres 17**, blobs on a local volume or EU S3-compatible storage, encrypted off-site backups.

## 1. Hosting

- **Provider/region:** e.g. Hetzner Cloud **Falkenstein (fsn1)** or **Nuremberg (nbg1)** — German
  data centres, ISO 27001, DPA (AVV) available in the console. Alternatives: IONOS, OVHcloud
  (Strasbourg/Frankfurt), Scaleway (Paris/Amsterdam). Sign the provider's DPA before go-live and
  list it in `docs/gdpr/subprocessors.md`.
- **Size:** CX32 (4 vCPU, 8 GB) handles hundreds of concurrent editors; geometry runs on clients.
- **Object storage (optional):** Hetzner Object Storage (fsn1/nbg1) or another EU S3 endpoint for
  blobs (`STORAGE_DRIVER=s3`). Use a dedicated bucket, private ACL, bucket-scoped keys.
- **E-mail:** an EU SMTP provider with a DPA (e.g. Mailjet/Brevo (FR), mailbox.org, Scaleway TEM).
  Configure SPF, DKIM and DMARC for the sender domain.

## 2. Server preparation

```bash
# Ubuntu 24.04 LTS, non-root sudo user, SSH keys only
sudo apt update && sudo apt -y upgrade && sudo apt -y install ufw unattended-upgrades   # restic/rclone run in the backup container
sudo ufw default deny incoming && sudo ufw allow OpenSSH && sudo ufw allow 80,443/tcp && sudo ufw allow 443/udp && sudo ufw enable
curl -fsSL https://get.docker.com | sh          # or the distro's docker packages
sudo mkdir -p /opt/cadsandbox && sudo chown $USER /opt/cadsandbox
git clone <repo> /opt/cadsandbox && cd /opt/cadsandbox
```

Point an `A`/`AAAA` record (e.g. `cad.example.eu`) at the VM before starting Caddy.

## 3. Configure

```bash
cp apps/server/.env.example .env && chmod 600 .env
openssl rand -base64 32   # → BETTER_AUTH_SECRET
openssl rand -base64 32   # → STORAGE_ENCRYPTION_KEY (keep an offline copy!)
openssl rand -base64 24   # → POSTGRES_PASSWORD
```

Minimum `.env` for production (compose sets `DATABASE_URL`, `TRUST_PROXY`, `DATA_DIR` itself):

```dotenv
DOMAIN=cad.example.eu
ACME_EMAIL=ops@example.eu
PUBLIC_URL=https://cad.example.eu
BETTER_AUTH_SECRET=…
STORAGE_ENCRYPTION_KEY=…
POSTGRES_PASSWORD=…
SMTP_HOST=in-v3.mailjet.com
SMTP_PORT=587
SMTP_USER=…
SMTP_PASS=…
MAIL_FROM="CadSandbox <no-reply@example.eu>"
ADMIN_EMAILS=you@example.eu
LEGAL_IMPRINT_URL=https://example.eu/impressum
LEGAL_PRIVACY_URL=https://example.eu/datenschutz
```

## 4. Run

```bash
docker compose up -d --build
docker compose logs -f app        # migrations run automatically at startup
curl -fsS https://cad.example.eu/api/health
```

The stack (`docker-compose.yml`): `db` on an internal-only network, `app` read-only root FS with
`/data` volume, all capabilities dropped, `caddy` with automatic Let's Encrypt certificates,
HTTP/3, request bodies up to 210 MB, access logs **without** IP addresses or cookies. Container logs
rotate at 5 × 10 MB per service.

Updates: `git pull && docker compose up -d --build` (migrations are forward-only and applied on
boot; take a backup first).

## 5. First admin

1. Put your address in `ADMIN_EMAILS`, start the stack, sign up in the web app with that address
   and click the verification link — you are promoted to `admin` on verification/login.
2. Alternatively (e.g. without SMTP): sign up, then on the host
   `docker compose exec app node dist/cli.js verify-email you@example.eu`
   `docker compose exec app node dist/cli.js grant-admin you@example.eu`
3. Remove `ADMIN_EMAILS` afterwards; manage roles in the admin panel (`user`/`support`/`admin`).
   Enable 2FA or a passkey on every staff account.

## 6. Backups (encrypted, off-site)

Backups run in a container (`apps/server/deploy/backup.Dockerfile`, entrypoint `backup.sh`) — the
`backup` service of `docker-compose.dokploy.yml`; the full runbook is
[`apps/server/deploy/BACKUP-RESTORE.md`](../apps/server/deploy/BACKUP-RESTORE.md).

- **Database:** daily `pg_dump --format=custom`, streamed by `restic backup --stdin-from-command` into
  a **restic** repository (client-side AES-256) at a **second EU S3 provider**, separate account. No dump
  is written to a local disk; a failed `pg_dump` creates no snapshot. Retention
  `restic forget --prune` **7 daily / 4 weekly / 6 monthly**; `restic check` weekly. A manifest with the
  exact row count of every table is stored with each run for restore verification.
- **Files (blob bucket):** `rclone sync` of `S3_BUCKET/S3_PREFIX` into an **rclone-crypt** prefix of the
  off-site bucket (encrypted names and contents, independent of the optional `STORAGE_ENCRYPTION_KEY`).
  Blobs are content-addressed and immutable, so the mirror transfers only new objects; objects removed
  by the blob GC are kept in `deleted/<date>/` for 190 days (the 6-month horizon of the dumps).
- **Failure visibility:** `BACKUP FAILED` log line, exit code 1, unhealthy container, and an optional
  heartbeat (`BACKUP_HEARTBEAT_URL`, Uptime Kuma push or healthchecks-style) — alert when no success
  arrives within 26 h.
- **Configuration is environment only** (no secrets in the repository): `BACKUP_S3_ENDPOINT`,
  `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`, `BACKUP_S3_SECRET_ACCESS_KEY`, `RESTIC_PASSWORD`
  (offline copy!) plus the optional `BACKUP_*` variables listed in the runbook.
- **Restore + quarterly drill:** `restore.sh db --to <empty database>` (pg_restore + row-count check
  against the manifest), `restore.sh blobs --to <scratch bucket> --as-of <date>`,
  `restore.sh verify-blobs` (sha256 of random blobs against their content address) — step by step in
  the runbook, § 5. Blobs and Yjs documents encrypted by the app stay encrypted in the backup, so keep
  `STORAGE_ENCRYPTION_KEY` (and old keys) together with `RESTIC_PASSWORD`.

The standalone stack (`docker-compose.yml`) can run the same image: point `DATABASE_URL` at its `db`
service and either use `STORAGE_DRIVER=s3` or mount the blob volume read-only and set
`BACKUP_LOCAL_BLOBS_DIR` (`BACKUP_BLOBS=false`).

## 7. Environment variables

| Variable | Default | Description |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables Secure cookies, HSTS and strict config checks |
| `PORT` / `HOST` | `8787` / `0.0.0.0` | listen address |
| `PUBLIC_URL` | `http://localhost:5173` (dev) | public origin; **https required** in production; used for links, cookies, passkeys |
| `BETTER_AUTH_SECRET` | dev: generated | ≥ 32 chars, required in production |
| `TRUSTED_ORIGINS` | – | extra allowed origins (CSRF, CORS-free) |
| `TRUST_PROXY` / `TRUSTED_PROXIES` | `false` / – | honour `X-Forwarded-For` from these proxy CIDRs |
| `DATABASE_URL` | – | Postgres URL; unset → embedded PGlite in `DATA_DIR/pglite` (dev/single-user) |
| `DATABASE_POOL_MAX` / `DATABASE_SSL` | `10` / `false` | pool size, TLS to Postgres |
| `DATA_DIR` | `apps/server/data` | blobs (`blobs/ab/cd/<sha256>`), temp files, PGlite |
| `STORAGE_DRIVER` | `local` | `local` or `s3` |
| `STORAGE_ENCRYPTION_KEY` | – | 32-byte base64 key → AES-256-GCM for blobs, collab docs, versions |
| `STORAGE_ENCRYPTION_OLD_KEYS` | – | decrypt-only keys during rotation |
| `S3_ENDPOINT` `S3_REGION` `S3_BUCKET` `S3_ACCESS_KEY_ID` `S3_SECRET_ACCESS_KEY` `S3_FORCE_PATH_STYLE` `S3_PREFIX` | – | EU S3-compatible storage |
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | – | outgoing mail (STARTTLS enforced on 587, pooled connections); temporary failures are retried for ~40 min (in memory only — mails can hold sign-in links), SMTP 5xx replies are not; unset in dev → mails printed to the log |
| `EMAIL_VERIFICATION` | `true` | require verified e-mail before login |
| `SIGNUP_ENABLED` | `true` (Dokploy compose: `false`) | allow self-service sign-up — the Dokploy compose keeps it closed unless set to `true` |
| `SIGNUP_CAPTCHA` / `SIGNUP_CAPTCHA_DIFFICULTY` | `true` / `100000` | self-hosted proof-of-work at sign-up (no third-party request); difficulty = max number the browser tries (~0.2–1 s) |
| `BLOCKED_EMAIL_DOMAINS` | – | extra e-mail domains refused at sign-up and e-mail change (a disposable-provider list is built in) |
| `PUBLIC_SHARING` | `true` | allow `public` visibility |
| `COLLAB_ENABLED` | `true` | enable `/collab` |
| `PASSKEY_RP_ID` / `PASSKEY_RP_NAME` | host of `PUBLIC_URL` / `CadSandbox` | WebAuthn relying party |
| `ADMIN_EMAILS` | – | promote these verified accounts to admin |
| `STORAGE_QUOTA_BYTES` | 1 GiB | per-user storage quota (blobs, designs, library items); at the limit uploads fail and the user's projects turn read-only |
| `MAX_PROJECTS_FREE` | `5` | cloud projects per (non-staff) user; trashed projects don't count, restoring one does |
| `COLLAB_MAX_MESSAGE_BYTES` | 16 MiB (≥ 64 KiB) | WebSocket message limit; the Dokploy compose sets 4 MiB (`4194304`) |
| `COLLAB_MAX_DOC_BYTES` | 64 MiB | a design (Yjs document) above this turns read-only for everyone |
| `VISITOR_EGRESS_BYTES_PER_HOUR` | 2 GiB | bytes per project and hour served to visitors (public projects, share-link guests); beyond → HTTP 429 |
| `NODE_OPTIONS` | `--enable-source-maps --max-old-space-size=1536` (image) | V8 heap cap in MB; keep `--enable-source-maps`. The Dokploy compose sets it from `APP_NODE_HEAP_MB` |
| `LEGAL_*_URL` | `/legal/*` | imprint, privacy, terms, DPA links shown by the web app |
| `LOG_LEVEL` | `info` | pino level |
| `SENTRY_DSN` / `SENTRY_ENVIRONMENT` | – / `NODE_ENV` | DSN of a self-hosted **GlitchTip** project (Sentry-compatible): server errors (every error-level log line, with stack) and browser errors (posted to `/api/client-errors`, forwarded by the server) are reported; unset = off |
| `RATE_LIMIT` / `JOBS_ENABLED` | `true` / `true` | switch rate limits / background jobs |
| `WEB_DIST_DIR` / `MIGRATIONS_DIR` | auto | overrides for non-standard layouts |

## 8. Operations

- **Health:** `GET /api/health` (DB check), Docker `HEALTHCHECK` built in. Point an external uptime
  monitor (e.g. Uptime Kuma) at `https://<APP_DOMAIN>/api/health`.
- **Error tracking:** deploy GlitchTip as its own Dokploy app (e.g. `errors.<APP_DOMAIN>`, EU host), set
  its event retention to 90 days (as stated in the privacy policy), create a project and put its DSN
  into `SENTRY_DSN`. The browser never contacts GlitchTip: it posts to `/api/client-errors` and the
  server forwards. Stack traces point at minified bundles unless source maps are uploaded.
- **Jobs** (in-process, one instance per job via Postgres advisory locks): trash purge (30 days),
  due account deletions (7-day grace), audit purge (365 days), expiry of links/grants/invites/
  sessions, blob garbage collection, hourly auto-versions (last 50 per document kept).
- **Scaling:** several app replicas need sticky WebSocket routing per document (or a Hocuspocus
  Redis extension) and a shared rate limiter; start with one instance.
- **Development:** `corepack pnpm dev` (web :5173 proxies `/api` + `/collab` to :8787, PGlite, mails
  in the console). Tests: `corepack pnpm --filter @cadsandbox/server test`.

## Dokploy (Traefik) — external data, zero downtime

`docker-compose.dokploy.yml` runs CadSandbox behind Dokploy's Traefik the same way as Bylbox:

1. **Data outside the containers.** Create a database and login on the existing PostgreSQL server
   (e.g. `CREATE ROLE cadsandbox LOGIN PASSWORD '…'; CREATE DATABASE prod_cadsandbox OWNER cadsandbox;`)
   and an S3 bucket + access key limited to it (MinIO). The app containers keep nothing on disk.
2. Create a **Docker Compose** service from this repository — compose path `./docker-compose.dokploy.yml`,
   branch `main`.
3. **Environment**: `APP_DOMAIN`, `PUBLIC_URL=https://<APP_DOMAIN>`, `DATABASE_URL`, `S3_ENDPOINT`, `S3_BUCKET`,
   `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `BETTER_AUTH_SECRET`, `STORAGE_ENCRYPTION_KEY`
   (`openssl rand -base64 32`, never change it later), `SMTP_*` + `MAIL_FROM`, `ADMIN_EMAILS`.
   **Backups** (§ 6): `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`, `BACKUP_S3_ACCESS_KEY_ID`,
   `BACKUP_S3_SECRET_ACCESS_KEY`, `RESTIC_PASSWORD`, recommended `BACKUP_HEARTBEAT_URL`; optional
   `BACKUP_SCHEDULE` (`15 3 * * *`, UTC), `BACKUP_KEEP_DAILY/WEEKLY/MONTHLY` (7/4/6) and the other
   `BACKUP_*` variables in the runbook. **Limits** (optional): `APP_MEM_LIMIT` (`2g`), `APP_CPUS` (`2`),
   `APP_NODE_HEAP_MB` (`1536` → `NODE_OPTIONS=--enable-source-maps --max-old-space-size=…`),
   `COLLAB_MAX_MESSAGE_BYTES` (`4194304`), `BACKUP_MEM_LIMIT` (`1g`), `BACKUP_CPUS` (`1`). Keep
   `APP_NODE_HEAP_MB` clearly below `APP_MEM_LIMIT` — buffers, WASM and native memory come on top.
4. Leave the **Domains** tab empty — Traefik labels define the route (HTTPS via `letsencrypt`).
5. **Advanced → Command** (zero-downtime deploy; `<app>` = the compose's app name in Dokploy):

   ```text
   compose -p <app> -f ./docker-compose.dokploy.yml build app backup && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --no-deps --wait --wait-timeout 240 app2 && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --no-deps --wait --wait-timeout 240 app && docker compose -p <app> -f ./docker-compose.dokploy.yml stop app2 && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --remove-orphans
   ```

   The standby `app2` answers while `app` is replaced, then stops again (collaboration keeps open
   documents in memory, so only one instance runs outside deployments). Document states stored during
   the overlap are merged, so no edit is lost. The final `up -d --remove-orphans` (re)starts the
   `backup` service with the freshly built image.
6. Point the domain's DNS A records — `<APP_DOMAIN>` and `www.<APP_DOMAIN>` — at the server; Traefik gets
   certificates for both and redirects `www` permanently to `<APP_DOMAIN>`. With a dynamic IP, add both
   record names to the `DOMAINS` list of the router's Vercel DNS updater (`<domain>*<record>+<record>`).
7. Keep Docker's build cache in check (Dokploy → Settings → daily Docker cleanup); every image build of
   this monorepo adds several GB of cache.
