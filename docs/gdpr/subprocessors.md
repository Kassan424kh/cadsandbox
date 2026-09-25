# Unterauftragsverarbeiter / Sub-processors

*Fill in the providers you actually use; each needs a signed DPA (AVV) and EU/EEA processing.*

| Provider | Service | Location of processing | Data | DPA |
|---|---|---|---|---|
| [e.g. Hetzner Online GmbH, Industriestr. 25, 91710 Gunzenhausen, DE] | Server hosting (VM, volumes) | [Falkenstein/Nuremberg, DE] | all stored data (encrypted at rest where configured) | [link/date] |
| [e.g. Hetzner Object Storage] *(optional)* | Blob storage (S3) | [fsn1, DE] | uploaded files (encrypted with `STORAGE_ENCRYPTION_KEY`) | [link/date] |
| [EU e-mail provider, e.g. Mailjet SAS / Brevo / mailbox.org] | Transactional e-mail | [EU] | e-mail address, name, message content (links) | [link/date] |
| [Backup storage provider — separate account] | Encrypted off-site backups (restic) | [EU] | client-side encrypted DB dumps and files | [link/date] |

Not used: CDNs, analytics, advertising, error-tracking SaaS, external fonts, AI services.
The web app makes no third-party requests (enforced by CSP and cross-origin isolation).

Changes are announced to organisation customers at least 30 days in advance (DPA § 6).
