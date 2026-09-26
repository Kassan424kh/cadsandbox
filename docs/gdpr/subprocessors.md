# Unterauftragsverarbeiter / Sub-processors

*Fill in the providers you actually use; each needs a signed DPA (AVV). All processing is in the EU/EEA except
e-mail delivery via Google (see the note below).*

| Provider | Service | Location of processing | Data | DPA |
|---|---|---|---|---|
| [e.g. Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, DE] | Server hosting (VM, volumes) | [Falkenstein/Nuremberg, DE] | all stored data (encrypted at rest where configured) | [link/date] |
| [e.g. Hetzner Object Storage] *(optional)* | Blob storage (S3) | [fsn1, DE] | uploaded files (encrypted with `STORAGE_ENCRYPTION_KEY`) | [link/date] |
| Google Ireland Limited, Gordon House, Barrow Street, Dublin 4, IE — Google Workspace (Gmail SMTP); sub-processor Google LLC, 1600 Amphitheatre Parkway, Mountain View, CA 94043, USA | Transactional e-mail (verification, password reset, invitations, notices); sender `contact@softwareler.com` | EU/EEA and USA — EU-US Data Privacy Framework (Art. 45 GDPR; Google LLC certified) + EU SCCs (Art. 46(2)(c)) | recipient e-mail address, name, message content (links), sending metadata | Google Workspace Data Processing Amendment — accept in the Admin console (Account → Legal and compliance) [date] |
| [Backup storage provider — EU S3-compatible object storage, separate account, e.g. name, address] | Encrypted off-site backups: restic repository (database dumps) + rclone-crypt mirror of the file store (`backup` service, `apps/server/deploy/BACKUP-RESTORE.md`) | [EU region] | client-side encrypted database dumps and files (AES-256 / XSalsa20-Poly1305, encrypted object names) — the provider holds ciphertext only | [link/date] |

Not used: CDNs, analytics, advertising, error-tracking SaaS, external fonts, AI services.
The web app makes no third-party requests (enforced by CSP and cross-origin isolation).

Changes are announced to organisation customers at least 30 days in advance (DPA § 6).

## Note for later — e-mail provider

- **Switch to an EU provider:** later switch to an EU provider such as **Brevo**, **Mailjet** or **mailbox.org**.
  That only means changing the five `SMTP_*` values (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`,
  `SMTP_PASS`) in the CadSandbox environment in Dokploy (plus `MAIL_FROM` if the sender address changes) and
  redeploying. Afterwards replace the Google row above and the e-mail/recipient sections of the privacy policy
  (`docs/gdpr/privacy-policy.{de,en}.md` and `apps/web/src/app/legal/privacy.ts`).
- **While Google is used:** `contact@softwareler.com` must be a **Google Workspace** account (a consumer Gmail account
  has no DPA and is not suitable). Gmail keeps a copy of every sent message in the account's *Sent* folder —
  delete these regularly or set a retention rule.
