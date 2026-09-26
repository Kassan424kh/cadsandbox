# CadSandbox — Security

This document describes the threat model, the controls implemented in `apps/server`, key management
and incident response. Report vulnerabilities to **security@&lt;your-domain&gt;** (PGP key in
`/.well-known/security.txt` of the deployment). Please do not open public issues for security bugs.

## 1. Architecture recap

All geometry and rendering happen in the browser. The server stores and relays only:
accounts and sessions (better-auth), organisations, projects/folders/sharing metadata, content-
addressed blobs, Yjs collaboration documents and their versions, support tickets, audit log.
One container serves the web app, the JSON API (`/api/*`) and the collaboration WebSocket
(`/collab`, Hocuspocus). Postgres 17 (or embedded PGlite for development) holds all state except
blobs (local disk or EU S3-compatible storage). Caddy terminates TLS.

## 2. Assets & threat model

| Asset | Threats | Primary controls |
|---|---|---|
| Accounts / sessions | credential stuffing, phishing, session theft, CSRF, account takeover | scrypt hashes, rate limits, 2FA (TOTP + backup codes, lockout), passkeys, HttpOnly+Secure+SameSite=Lax cookies, Origin/Sec-Fetch-Site checks, no cookie cache (instant revocation) |
| Project content (docs, blobs) | IDOR, link leakage, over-sharing, cross-tenant access, malicious uploads | single role resolver (`services/access.ts`) for REST and WebSocket, 404 for foreign private projects, hashed share tokens with optional password/expiry, read-only sockets for viewers, sha256-verified uploads, magic-byte sniffing, sandboxed downloads |
| Collaboration channel | cross-site WebSocket hijacking, stale access after revocation, oversized messages | Origin allow-list on upgrade, per-document authentication, re-validation + kick on ACL/session change and every 2 min, 16 MiB message cap |
| Admin / support powers | insider abuse, silent data access | admin vs support roles, no content access without a user-granted, time-boxed, revocable support grant, impersonation limited to 1 h, sees metadata only (content solely via the user's support grant, read-only) and blocked from sensitive actions, every privileged action and every impersonated content access audited |
| Stored data at rest | disk/backup theft, provider access | AES-256-GCM (per-object HKDF keys, identity-bound AAD) for blobs and Yjs state, encrypted restic backups, EU hosting |
| Personal data (GDPR) | over-collection, retention creep, log leakage | data minimisation, IP truncation/hashing, redacted logs, retention jobs, export & deletion endpoints |
| Availability | request floods, upload abuse, slowloris | per-IP/per-user limits, body limits, streaming uploads with hard caps, quotas, header/request timeouts |

Out of scope: compromise of the user's device/browser, malicious collaborators who legitimately
hold `editor` rights (they can change any document content), the operator's host OS.

## 3. Controls in detail

### Authentication (better-auth 1.7)
- E-mail + password, **min. 10 / max. 128 characters**, scrypt hashing (better-auth default).
- E-mail verification required before login (`EMAIL_VERIFICATION=true`, default); password reset
  links expire after 1 h and revoke all sessions; verification links expire after 24 h.
- TOTP 2FA with 10 backup codes and account lockout (5 failures → 15 min); passkeys (WebAuthn,
  `rpID` = public hostname); organisation plugin (owner/admin/member, e-mail invitations requiring a
  verified address); admin plugin (ban, impersonation).
- Session cookie `__Secure-csb.session_token` (production): HttpOnly, Secure, SameSite=Lax,
  30-day rolling expiry, validated against the database on every request (revocation is immediate).
- Telemetry is disabled (`telemetry.enabled=false`, `BETTER_AUTH_TELEMETRY=0`).
- Unused/unsafe endpoints are disabled over HTTP (`/delete-user`, admin set-password/update-user/
  remove-user/…); the audited `/api/admin/*` and GDPR `/api/me` flows replace them.
- Bootstrap admins: `ADMIN_EMAILS` grants `admin` only once the address is **verified**, or via the
  operator CLI (`node dist/cli.js grant-admin <email>`), which requires shell access.

### Authorisation
- One function computes the effective role for REST and collab: max(owner, direct member, org grant
  via membership, accepted share link, public → viewer, valid support grant → viewer for staff) —
  exactly `packages/shared/src/roles.ts`. Actions are checked with the shared `can()`.
- Private projects answer **404** to outsiders (existence is never revealed); insufficient roles
  get 403. Trashed projects are visible to the owner only.
- Share links: 32 random bytes (base64url), only `sha256` stored, optional scrypt-hashed password,
  optional expiry, active only while project visibility is `link`/`public`. Memberships gained
  through a link die with the link. Guests (no account) can only use **viewer** links — read-only,
  nothing stored; editor/commenter links require sign-in and acceptance. For password-protected
  viewer links the password is checked once at accept (per-link lockout after 10 failures/10 min)
  and the guest receives a signed grant (HMAC-SHA256, key derived from `BETTER_AUTH_SECRET`,
  ≤ 12 h and never past the link's expiry) used instead of the raw token; every use re-checks the
  link, so deleting it revokes grants and live collab connections at once.
- Support access: only through a ticket in which the user grants 1–30 days of read-only access to
  one project; revocable at any time; closed tickets end the grant; every staff access is audited
  (`support.project.access`, de-duplicated per staff member, project and method within 5 minutes).
- Impersonation (admins only, ≤ 1 h, persistent banner) does **not** bypass the content rule: while
  a session carries `impersonatedBy`, project *metadata* stays visible (dashboard lists, project
  settings, member/link lists — thumbnails are removed from lists), but *content* — collab
  documents, blobs, versions, thumbnails, comments, library items/assets, data export — is served
  only while the impersonated user has an active support grant for that project, and then
  read-only. Every allowed content access is audited as `admin.impersonate.content` (actor = admin,
  `meta.impersonatedUserId`, route or collab document; not de-duplicated); refused attempts as
  `admin.impersonate.content_denied` (de-duplicated per admin, project and route within 5 minutes).
  Impersonation sessions are also refused (403, `details.reason = 'impersonation'`): account
  deletion, data export, password/e-mail/2FA/passkey/session changes, all sharing changes (members,
  links, visibility, org grants, org membership, accepting links), copying or permanently deleting
  projects, and support grants. Live collab connections of an impersonation session close when the
  grant is revoked/expires or impersonation stops; the web app drops cached cloud data whenever the
  signed-in identity (incl. impersonation) changes.
- Live collab connections are re-checked on every access change (members, roles, links, org
  grants, org removal *and* leaving, ban, logout, single-session revocation, password reset) and
  closed when access is gone or the role changed (also viewer ↔ commenter). The web app then drops
  its local copy of the project and reopens it with the new role, or shows that access is gone.
- Collaboration presence cannot be spoofed: the server overwrites `awareness.user.id/name` with
  the authenticated identity (anonymous viewers are marked `anonymous: true`) and drops oversized
  presence states.
- Collection item assets must be in the creator's own asset space (prevents hash-guessing access).

### Web security
- Headers on every response: strict CSP (`default-src 'self'; script-src 'self' 'wasm-unsafe-eval';
  worker-src 'self' blob:; img-src 'self' data: blob:; connect-src 'self' ws: wss:; style-src 'self'
  'unsafe-inline'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none';
  form-action 'self'`), HSTS (prod, preload), COOP/COEP/CORP same-origin/require-corp,
  `Referrer-Policy: no-referrer`, restrictive `Permissions-Policy`, `nosniff`, `X-Frame-Options`.
- CSRF: SameSite=Lax cookies **plus** Origin (or `Sec-Fetch-Site: same-origin`) validation on every
  state-changing `/api` request; cookie-bearing writes without either header are refused.
- WebSocket upgrades require an allow-listed `Origin`.
- Input validation with the shared zod schemas; JSON body limits per route; errors are generic
  `{ error: { code, message } }` without stack traces.
- Uploads: streamed to disk, hard size cap (200 MiB), per-user quota (charged to the project owner),
  sha256 must equal the URL hash, MIME detected from magic bytes (client `Content-Type` ignored).
  Downloads: sanitised `Content-Type`, `nosniff`, `Content-Disposition: attachment` for anything but
  raster images, sandboxing CSP, `Cache-Control: private, immutable`.

### Rate limiting
In-process fixed windows keyed by hashed IP and user id: API 1200/min/IP and 2400/min/user, auth
60/min/IP plus better-auth rules (sign-in 10/min, sign-up 5/10 min, reset 3/15 min, 2FA 10/min),
share-link acceptance 30/10 min per IP, wrong link passwords 10/10 min per link, uploads 300/min, exports 3/h, invitations
60/h, collab upgrades 120/min/IP. For several app instances add a shared limiter at the proxy.

### Logging & audit
- pino JSON logs; cookies, auth headers, tokens and passwords are redacted, share tokens are
  stripped from URLs, e-mails are masked, IPs appear only as a salted HMAC that rotates daily.
- `audit_log` records: sign-up/login (incl. failures for existing accounts), logout, 2FA/passkey/
  password/e-mail changes, session revocations, impersonation start/stop and every content access
  (or refused attempt) during impersonation, admin actions (ban, role,
  2FA reset, verification, deletion, announcements), share changes, project trash/delete/restore/
  visibility, version restores, support grants/revocations/staff access, data exports and deletion
  requests. Stored IPs are truncated (/24, /48). Retention 365 days; actors are anonymised when an
  account is deleted.

## 4. Key management

| Secret | Purpose | Generation | Rotation |
|---|---|---|---|
| `BETTER_AUTH_SECRET` | signs cookies/tokens | `openssl rand -base64 32` | rotate on suspicion; all sessions end |
| `STORAGE_ENCRYPTION_KEY` | master key for at-rest encryption | `node dist/cli.js generate-key` | add new key, move old to `STORAGE_ENCRYPTION_OLD_KEYS` (decrypt-only); new writes use the new key; collab docs are re-encrypted on their next save, existing blobs and versions keep their original key — never drop an old key while such data exists |
| `POSTGRES_PASSWORD` | database | password manager | yearly / on staff change |
| SMTP / S3 credentials | provider access | provider console | yearly, least privilege (bucket-scoped keys) |
| `RESTIC_PASSWORD` (+ `BACKUP_BLOB_PASSWORD` if set) | encryption of the off-site DB backups and blob mirror | password manager + **offline copy** | never lose it — backups are unrecoverable without it |

Secrets are passed as environment variables (`.env` with mode 600, or Docker secrets); they are
never logged. Keep an offline, access-controlled copy of `STORAGE_ENCRYPTION_KEY` — losing it
makes blobs and documents unrecoverable. Key ids (first 4 bytes of sha256(key)) are embedded in
every ciphertext so old keys can be retired once no data references them.

## 5. Incident response

1. **Detect** — alerts on 5xx rate, auth failure spikes (`auth.login.failed`), unusual admin
   actions (`admin.*`), health check failures; users report via security@.
2. **Contain** — ban accounts / revoke sessions (`/api/admin/users/:id/ban|revoke-sessions`),
   delete leaked share links, disable features via env (`SIGNUP_ENABLED`, `PUBLIC_SHARING`,
   `COLLAB_ENABLED`), rotate `BETTER_AUTH_SECRET` to end all sessions, block IPs at Caddy/firewall.
3. **Preserve evidence** — snapshot volumes, export `audit_log` for the affected period, keep
   container logs (they rotate after ~50 MB per service).
4. **Assess** — scope of personal data affected, number of data subjects, likely consequences.
5. **Notify** — GDPR Art. 33: supervisory authority within **72 hours** of becoming aware, unless
   the breach is unlikely to result in a risk; Art. 34: inform affected users without undue delay
   if the risk is high. Organisations using CadSandbox as processor are informed without undue
   delay per the DPA (docs/gdpr/avv-dpa.md). Document every breach in the internal breach register.
6. **Recover & learn** — patch, restore from encrypted backups if needed, post-mortem within
   two weeks, update this document and the TOMs.

## 6. Operational checklist

- [ ] `NODE_ENV=production`, `PUBLIC_URL=https://…`, strong `BETTER_AUTH_SECRET`
- [ ] `STORAGE_ENCRYPTION_KEY` set and backed up offline
- [ ] SMTP over TLS with an EU provider, SPF/DKIM/DMARC for the sender domain
- [ ] `TRUST_PROXY=true` only behind Caddy; database not exposed (internal Docker network)
- [ ] Daily encrypted off-site backups (backup service healthy, heartbeat monitored) and a quarterly restore drill — apps/server/deploy/BACKUP-RESTORE.md
- [ ] Dependency updates monthly (`pnpm outdated`, advisories), base images rebuilt
- [ ] First admin created, `ADMIN_EMAILS` cleared afterwards
