# CadSandbox — Data protection (DSGVO/GDPR) documentation

Templates and records that match the processing actually implemented in `apps/server`. Replace all
`[placeholders]` and have the final versions reviewed by your data protection officer / counsel.

| Document | Purpose |
|---|---|
| [privacy-policy.de.md](privacy-policy.de.md) / [privacy-policy.en.md](privacy-policy.en.md) | Datenschutzerklärung / privacy notice (Art. 13/14) |
| [verarbeitungsverzeichnis.md](verarbeitungsverzeichnis.md) | Verzeichnis von Verarbeitungstätigkeiten (Art. 30 Abs. 1 und 2) |
| [toms.md](toms.md) | Technische und organisatorische Maßnahmen (Art. 32) |
| [avv-dpa.md](avv-dpa.md) | Auftragsverarbeitungsvertrag / DPA for organisations (Art. 28) |
| [retention.md](retention.md) | Löschkonzept / retention schedule |
| [subprocessors.md](subprocessors.md) | Unterauftragsverarbeiter / sub-processors |
| [dsr-procedures.md](dsr-procedures.md) | Betroffenenrechte — procedures (Art. 12–22) |
| [dpia-screening.md](dpia-screening.md) | DSFA-Schwellwertanalyse / DPIA screening (Art. 35) |

## Roles

- **Controller (Verantwortlicher):** the operator of the CadSandbox instance for accounts,
  security logging, support and for projects of individual users.
- **Processor (Auftragsverarbeiter):** the operator, for personal data inside projects of
  **organisations** that use CadSandbox for their business (their employees, clients, building
  data) — governed by the DPA in `avv-dpa.md`.

## Privacy by design (what the software guarantees)

- No third-party requests from the web app (self-hosted fonts/WASM, cross-origin isolation), no
  tracking, no analytics, only a strictly necessary session cookie (no consent banner needed,
  § 25 Abs. 2 Nr. 2 TDDDG).
- Geometry/rendering on the client; the server stores the collaborative document and uploaded files.
- IP addresses: truncated before storage (/24 IPv4, /48 IPv6), hashed with a daily rotating salt in
  logs; the reverse proxy logs no IPs.
- Optional AES-256-GCM encryption at rest for files, documents and versions; EU hosting only.
- Self-service export (ZIP, Art. 15/20) and deletion with 7-day grace period (Art. 17).
- Support staff see project content only after the user grants time-boxed, revocable access;
  every access is audited.
