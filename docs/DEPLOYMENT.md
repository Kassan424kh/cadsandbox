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
sudo apt update && sudo apt -y upgrade && sudo apt -y install ufw unattended-upgrades restic
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

`apps/server/deploy/backup.sh` creates a `pg_dump` and backs it up together with the blob volume to
a **restic** repository (client-side AES-256 encryption, deduplicated) in a *separate* EU storage
account. Retention: 7 daily, 4 weekly, 6 monthly.

```bash
sudo install -m 600 /dev/null /etc/cadsandbox/restic-password && openssl rand -base64 32 | sudo tee /etc/cadsandbox/restic-password
export RESTIC_REPOSITORY=s3:https://fsn1.your-objectstorage.com/cadsandbox-backups RESTIC_PASSWORD_FILE=/etc/cadsandbox/restic-password
restic init
# cron: 15 3 * * *  COMPOSE_DIR=/opt/cadsandbox /opt/cadsandbox/apps/server/deploy/backup.sh
```

Restore drill (monthly): `restic restore latest --target /tmp/restore`, then
`docker compose exec -T db pg_restore -U cadsandbox -d cadsandbox --clean < /tmp/restore/…/cadsandbox-*.dump`
and copy the blobs back into the `appdata` volume. Blobs and Yjs documents stay encrypted with
`STORAGE_ENCRYPTION_KEY`, so keep that key (and old keys) with the restic password.

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
| `SMTP_HOST` `SMTP_PORT` `SMTP_SECURE` `SMTP_USER` `SMTP_PASS` `MAIL_FROM` | – | outgoing mail (STARTTLS enforced on 587); unset in dev → mails printed to the log |
| `EMAIL_VERIFICATION` | `true` | require verified e-mail before login |
| `SIGNUP_ENABLED` | `true` | allow self-service sign-up |
| `PUBLIC_SHARING` | `true` | allow `public` visibility |
| `COLLAB_ENABLED` | `true` | enable `/collab` |
| `PASSKEY_RP_ID` / `PASSKEY_RP_NAME` | host of `PUBLIC_URL` / `CadSandbox` | WebAuthn relying party |
| `ADMIN_EMAILS` | – | promote these verified accounts to admin |
| `STORAGE_QUOTA_BYTES` | 5 GiB | per-user storage quota |
| `MAX_PROJECTS_FREE` | `100` | projects per (non-staff) user |
| `COLLAB_MAX_MESSAGE_BYTES` | 16 MiB | WebSocket message limit |
| `LEGAL_*_URL` | `/legal/*` | imprint, privacy, terms, DPA links shown by the web app |
| `LOG_LEVEL` | `info` | pino level |
| `RATE_LIMIT` / `JOBS_ENABLED` | `true` / `true` | switch rate limits / background jobs |
| `WEB_DIST_DIR` / `MIGRATIONS_DIR` | auto | overrides for non-standard layouts |

## 8. Operations

- **Health:** `GET /api/health` (DB check), Docker `HEALTHCHECK` built in.
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
   (`openssl rand -base64 32`, never change it later), `SMTP_*` + `MAIL_FROM`, `ADMIN_EMAILS`, optional
   `BACKUP_KEEP_DAYS` (default 14).
4. Leave the **Domains** tab empty — Traefik labels define the route (HTTPS via `letsencrypt`).
5. **Advanced → Command** (zero-downtime deploy; `<app>` = the compose's app name in Dokploy):

   ```text
   compose -p <app> -f ./docker-compose.dokploy.yml build app && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --no-deps --wait --wait-timeout 240 app2 && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --no-deps --wait --wait-timeout 240 app && docker compose -p <app> -f ./docker-compose.dokploy.yml stop app2 && docker compose -p <app> -f ./docker-compose.dokploy.yml up -d --remove-orphans
   ```

   The standby `app2` answers while `app` is replaced, then stops again (collaboration keeps open
   documents in memory, so only one instance runs outside deployments). Document states stored during
   the overlap are merged, so no edit is lost.
6. Point the domain's DNS A record at the server. With a dynamic IP, add the record name to the
   `DOMAINS` list of the router's Vercel DNS updater (`<domain>*<record>+<record>`).
7. Keep Docker's build cache in check (Dokploy → Settings → daily Docker cleanup); every image build of
   this monorepo adds several GB of cache.
